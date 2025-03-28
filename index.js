import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import puppeteer from "puppeteer";
const app = express();
dotenv.config()
app.use(cors());
app.use(express.json())

const PORT = process.env.PORT | 5000;

const CLIENT_ID = process.env.ML_CLIENT_ID;
const CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
const REDIRECT_URI = process.env.ML_REDIRECT_URI;

app.get("/status", (req,res) =>{
    res.json({message: "Hi Fran! Server is runnning :)"})
});

app.post("/auth/mercadolibre", async (req, res) => { 
    try {
      const response = await axios.post("https://api.mercadolibre.com/oauth/token", {
        client_id: req.body.client_id,
        client_secret: req.body.client_secret,
        redirect_uri: req.body.redirect_uri,
        grant_type: req.body.grant_type,
      });
      res.json(response.data);
    } catch (error) {
      console.error("❌ Error autenticando en MercadoLibre:", error.response?.data || error.message);
      res.status(500).json({ error: "Error autenticando en MercadoLibre", details: error.response?.data || error.message });
    }
  });

app.get('/auth/mercadolibre/callback', async (req, res) => {
    const { code } = req.query;
    console.log(code)

    if (!code) {
        return res.status(400).json({ error: 'Código de autorización faltante.' });
    }

    try {
        const response = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
            params: {
                grant_type: "authorization_code",
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code,
                redirect_uri: REDIRECT_URI
            },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const { access_token, refresh_token, expires_in } = response.data;
        console.log(response.data)

        res.json({ access_token, refresh_token, expires_in });

    } catch (error) {
        console.error("Error getting the token", error?.response?.data || error.message);
        res.status(500).json({ error: "Error getting the token" });
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
    const access_token = req.headers.authorization;
    const { q } = req.query;

    if (!q) {
        return res.status(400).json({ error: "Missing search parameter" });
    }

    if (!access_token) {
        return res.status(400).json({ error: "User is not authenticated" });
    }

    try {
        const response = await axios.get(`https://api.mercadolibre.com/sites/MLA/search`, {
            params: {
                q: q,
                status: 'active',
                limit: 10 
            },
            headers: {
                Authorization: `Bearer ${access_token}`
            }
        });

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
                return item;
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

        const totalPrice = validProducts.reduce((acc, product) => acc + product.price, 0);
        const averagePrice = validProducts.length > 0 ? totalPrice / validProducts.length : 0;

        const result = {
            products: validProducts,
            averagePrice: averagePrice.toFixed(2)
        };

        res.json(result);
        console.log(result)
    } catch (error) {
        console.error("No product was found, please search another item:", error.response?.data || error.message);
        res.status(500).json({ error: 'Error al buscar el producto', details: error.response?.data || error.message });
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
});