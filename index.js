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

// Variable para almacenar el token de usuario
let userToken = null;

// Endpoint para iniciar la autenticación
app.get("/auth/mercadolibre", async (req, res) => {
  try {
    const authUrl = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}`;
    res.json({ authUrl });
  } catch (error) {
    console.error("Error iniciando autenticación:", error);
    res.status(500).json({ error: "Error iniciando autenticación" });
  }
});

// Endpoint para manejar el callback de autorización
app.get("/auth/mercadolibre/callback", async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).json({ error: "Código de autorización faltante" });
  }

  try {
    const response = await axios.post(
      "https://api.mercadolibre.com/oauth/token",
      qs.stringify({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
        redirect_uri: REDIRECT_URI
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        }
      }
    );

    userToken = response.data.access_token;
    console.log("Token de usuario obtenido exitosamente");
    res.json({ message: "Autenticación exitosa" });
  } catch (error) {
    console.error("Error obteniendo token:", error.response?.data || error.message);
    res.status(500).json({ error: "Error obteniendo token" });
  }
});

// Middleware para verificar el token de usuario
const ensureUserToken = async (req, res, next) => {
  if (!userToken) {
    return res.status(401).json({ error: "No autenticado" });
  }
  next();
};

// Endpoint de búsqueda usando la API pública
app.get("/search", async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: "Parámetro de búsqueda faltante" });
  }

  try {
    console.log("Buscando productos para:", q);
    
    const response = await axios.get(
      `https://api.mercadolibre.com/sites/MLA/search`,
      {
        params: {
          q: q,
          status: "active",
          limit: 10
        },
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    console.log("Respuesta de MercadoLibre:", response.data);

    if (!response.data.results || response.data.results.length === 0) {
      return res.status(404).json({ error: "No se encontraron productos" });
    }

    const filteredProducts = response.data.results
      .map((item) => {
        try {
          const hasValidTags = item.tags && Array.isArray(item.tags);
          const isPack = item.attributes?.some(
            (attr) =>
              attr.name === "Formato de venta" && attr.value_name === "Pack"
          );
          const hasPromotion =
            item.promotions ||
            item.promotion_decorations ||
            (item.sale_price && item.sale_price.amount !== item.price);

          if (
            isPack ||
            hasPromotion ||
            item.available_quantity <= 0 ||
            !hasValidTags ||
            item.tags.includes("deal_of_the_day") ||
            item.tags.includes("pack_of_2") ||
            item.tags.includes("pack_of_3")
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
        } catch (error) {
          console.error("Error procesando producto:", error);
          return null;
        }
      })
      .filter((item) => item !== null);

    if (filteredProducts.length === 0) {
      return res.status(404).json({ error: "No se encontraron productos válidos" });
    }

    const totalPrice = filteredProducts.reduce(
      (acc, product) => acc + product.price,
      0
    );
    const averagePrice =
      filteredProducts.length > 0 ? totalPrice / filteredProducts.length : 0;

    res.json({
      products: filteredProducts,
      averagePrice: averagePrice.toFixed(2)
    });
  } catch (error) {
    console.error("Error en la búsqueda:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    
    if (error.response) {
      // Si la API de MercadoLibre devuelve un error
      res.status(error.response.status).json({ 
        error: "Error en la API de MercadoLibre",
        details: error.response.data
      });
    } else if (error.request) {
      // Si no se pudo hacer la petición
      res.status(500).json({ 
        error: "No se pudo conectar con MercadoLibre",
        details: error.message
      });
    } else {
      // Error en la configuración de la petición
      res.status(500).json({ 
        error: "Error al realizar la búsqueda",
        details: error.message
      });
    }
  }
});

app.get("/status", (req,res) =>{
    res.json({message: "Hi Fran! Server is runnning :)"})
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