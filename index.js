import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import puppeteer from "puppeteer";
import qs from "qs"
const app = express();
dotenv.config()
app.use(cors());
app.use(express.json())
const PORT = process.env.PORT | 3000;

const CLIENT_ID = process.env.ML_CLIENT_ID;
const CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
const REDIRECT_URI = process.env.ML_REDIRECT_URI;

app.get("/status", (req,res) =>{
    res.json({message: "Hi Fran! Server is runnning :)"})
});

app.post("/auth/mercadolibre", async (req, res) => { 
    try {
      // Primero, obtenemos el código de autorización
      const authUrl = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}`;
      
      // Redirigimos al usuario a la página de autorización de MercadoLibre
      res.json({ 
        authUrl,
        message: "Por favor, autoriza la aplicación en MercadoLibre"
      });
    } catch (error) {
      console.error("❌ Error iniciando autenticación:", error);
      res.status(500).json({ 
        error: "Error iniciando autenticación", 
        details: error.message 
      });
    }
});

app.get('/auth/mercadolibre/callback', async (req, res) => {
    const { code } = req.query;
    console.log("Código recibido:", code);

    if (!code) {
        return res.status(400).json({ error: 'Código de autorización faltante.' });
    }

    try {
        const response = await axios.post(
            'https://api.mercadolibre.com/oauth/token',
            qs.stringify({
                grant_type: "authorization_code",
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code: code,
                redirect_uri: REDIRECT_URI
            }),
            {
                headers: { 
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                }
            }
        );

        const { access_token, refresh_token, expires_in } = response.data;
        console.log("✅ Token obtenido:", response.data);

        res.json({ 
            access_token, 
            refresh_token, 
            expires_in,
            message: "Autenticación exitosa"
        });

    } catch (error) {
        console.error("❌ Error obteniendo el token:", error?.response?.data || error.message);
        res.status(500).json({ 
            error: "Error obteniendo el token", 
            details: error.response?.data || error.message 
        });
    }
});

app.get('/my-items', async (req, res) => {
    const access_token = req.query.access_token;

    if (!access_token) {
        return res.status(400).json({ error: 'Falta access_token' });
    }

    try {
        const userResponse = await axios.get('https://api.mercadolibre.com/users/me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const user_id = userResponse.data.id;

        const response = await axios.get(`https://api.mercadolibre.com/users/${user_id}/items/search`, {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error al obtener publicaciones:', error.response?.data || error.message);
        res.status(500).json({ error: 'Error al obtener publicaciones', details: error.response?.data || error.message });
    }
});

app.get('/search', async (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            error: "Error al buscar el producto", 
            details: { 
                code: "unauthorized", 
                message: "authorization value not present or invalid format" 
            } 
        });
    }

    const access_token = authHeader.split(' ')[1];
    const { q } = req.query;

    if (!q) {
        return res.status(400).json({ error: "Missing search parameter" });
    }

    try {
        console.log("Token usado para la búsqueda:", access_token); // Para debug
        const response = await axios.get(`https://api.mercadolibre.com/sites/MLA/search`, {
            params: {
                q: q,
                status: 'active',
                limit: 10 
            },
            headers: {
                Authorization: `Bearer ${access_token}`,
                'Accept': 'application/json'
            }
        });

        console.log("Respuesta de MercadoLibre:", response.data); // Para debug

        const filteredProducts = response.data.results.map(item => {
            const hasValidTags = item.tags && Array.isArray(item.tags);
            const isPack = item.attributes.some(attr => attr.name === "Formato de venta" && attr.value_name === "Pack");
            const hasPromotion = item.promotions || item.promotion_decorations || item.sale_price?.amount !== item.price;

            if (
                isPack ||
                hasPromotion || 
                item.available_quantity <= 0 || 
                !hasValidTags ||
                item.tags.includes('deal_of_the_day') || 
                item.tags.includes('pack_of_2') || 
                item.tags.includes('pack_of_3')
            ) {
                return null;
            }

            return {
                id: item.id,
                title: item.title,
                price: item.sale_price ? item.sale_price.amount : item.price,
                currency: item.currency_id,
                thumbnail: item.thumbnail,
                permalink: item.permalink
            };
        });

        const validProducts = filteredProducts.filter(item => item !== null);

        if (validProducts.length === 0) {
            return res.status(404).json({ 
                error: "No se encontraron productos", 
                details: "No hay productos disponibles que cumplan con los criterios de búsqueda" 
            });
        }

        const totalPrice = validProducts.reduce((acc, product) => acc + product.price, 0);
        const averagePrice = validProducts.length > 0 ? totalPrice / validProducts.length : 0;

        const result = {
            products: validProducts,
            averagePrice: averagePrice.toFixed(2)
        };

        res.json(result);
    } catch (error) {
        console.error("Error en la búsqueda de MercadoLibre:", error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ 
            error: 'Error al buscar el producto', 
            details: error.response?.data || error.message 
        });
    }
});

app.get("/search-amazon", async (req, res) => {
    try {
        const { query } = req.query;
        console.log(query);

        if (!query) {
            return res.status(400).json({ error: "Query parameter is required" });
        }

        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();

        const amazonURL = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
        await page.goto(amazonURL, { waitUntil: "domcontentloaded" });

        const products = await page.evaluate(() => {
            const items = document.querySelectorAll('[data-component-type="s-search-result"]');
            return Array.from(items).slice(0, 5).map((item) => {
                const title = item.querySelector(".a-link-normal .s-line-clamp-2 .s-link-style .a-text-normal")?.innerText || "No title";
                const priceText = item.querySelector(".a-price .a-offscreen")?.innerText || "No price";
                const link = "https://www.amazon.com" + (item.querySelector("h2 a")?.getAttribute("href") || "#");
                const image = item.querySelector("img")?.getAttribute("src") || "";

                let price = parseFloat(priceText.replace(/[^0-9.]/g, ""));
                if (isNaN(price)) {
                    price = null; 
                }

                return { title, price, link, image };
            });
        });

        await browser.close();

        const validProducts = products.filter(product => product.price !== null);

        const totalPrice = validProducts.reduce((acc, product) => acc + product.price, 0);
        const averagePrice = validProducts.length > 0 ? totalPrice / validProducts.length : 0;

        res.json({
            products: validProducts,
            averagePrice: averagePrice.toFixed(2)
        });

    } catch (error) {
        console.error("Error fetching Amazon products:", error);
        res.status(500).json({ error: "Error al obtener los productos de Amazon", details: error.message });
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server running on port ${PORT}`);
});