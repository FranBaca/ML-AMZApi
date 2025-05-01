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

const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

app.get("/status", (req,res) =>{
  res.json({message: "Hi Fran! Server is runnning :)"})
});

async function getAccessToken() {
    const credentials = Buffer
        .from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`)
        .toString('base64');

    try {
        const response = await axios.post(
            'https://api.ebay.com/identity/v1/oauth2/token',
            'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
            {
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        return response.data.access_token;
    } catch (error) {
        console.error('Error al obtener el token:', error.response?.data || error.message);
        return null;
    }
}

app.get('/search', async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Falta parámetro de búsqueda (q)' });
  }

  try {
    console.log('Obteniendo token de acceso...');
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error('No se pudo obtener el token de acceso');
    }
    console.log('Token obtenido exitosamente');

    console.log('Obteniendo tasa de cambio...');
    const exchangeResponse = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
    const usdToArsRate = exchangeResponse.data.rates.ARS;
    console.log('Tasa de cambio obtenida:', usdToArsRate);

    console.log('Buscando productos en eBay...');
    const response = await axios.get(`https://api.ebay.com/buy/browse/v1/item_summary/search`, {
      params: {
        q,
        limit: 10
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      }
    });

    console.log('Respuesta de eBay recibida');
    const items = response.data.itemSummaries || [];

    if (items.length === 0) {
      return res.status(404).json({ error: 'No se encontraron productos' });
    }

    const products = items.map(item => ({
      title: item.title,
      price: item.price.value,
      priceARS: (parseFloat(item.price.value) * usdToArsRate).toFixed(2),
      currency: item.price.currency,
      thumbnail: item.image?.imageUrl || null,
      link: item.itemWebUrl
    }));

    const totalPrice = products.reduce((acc, p) => acc + parseFloat(p.price), 0);
    const averagePrice = products.length ? (totalPrice / products.length).toFixed(2) : '0';
    const averagePriceARS = products.length ? (parseFloat(averagePrice) * usdToArsRate).toFixed(2) : '0';

    console.log('Búsqueda completada exitosamente');
    res.json({
      products,
      averagePrice,
      averagePriceARS,
      exchangeRate: usdToArsRate
    });

  } catch (error) {
    console.error('Error detallado:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      stack: error.stack
    });

    if (error.response?.status === 401) {
      return res.status(401).json({ 
        error: 'Error de autenticación',
        details: 'Token inválido o expirado'
      });
    }

    if (error.response?.status === 404) {
      return res.status(404).json({ 
        error: 'No se encontraron productos',
        details: error.response?.data?.message
      });
    }

    res.status(500).json({ 
      error: 'Error al buscar productos',
      details: error.response?.data || error.message
    });
  }
});

app.get("/search-amazon", async (req, res) => {
    try {
        const { query } = req.query;
        console.log("Buscando en Amazon:", query);

        if (!query) {
            return res.status(400).json({ error: "Query parameter is required" });
        }

        const browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        const amazonURL = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
        console.log("URL de búsqueda:", amazonURL);
        
        await page.goto(amazonURL, { 
            waitUntil: "domcontentloaded",
            timeout: 30000 
        });

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

        if (validProducts.length === 0) {
            return res.status(404).json({ error: "No se encontraron productos válidos" });
        }

        const totalPrice = validProducts.reduce((acc, product) => acc + product.price, 0);
        const averagePrice = validProducts.length > 0 ? totalPrice / validProducts.length : 0;

        console.log("Productos encontrados:", validProducts.length);
        res.json({
            products: validProducts,
            averagePrice: averagePrice.toFixed(2)
        });

    } catch (error) {
        console.error("Error en la búsqueda de Amazon:", error);
        res.status(500).json({ 
            error: "Error al obtener los productos de Amazon",
            details: error.message 
        });
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server running on port ${PORT}`);
});