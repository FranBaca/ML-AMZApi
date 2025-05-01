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

  if (!q) return res.status(400).json({ error: 'Falta parámetro de búsqueda (q)' });

  try {
      const accessToken = await getAccessToken();

      // Obtener tasa de cambio USD a ARS
      const exchangeResponse = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
      const usdToArsRate = exchangeResponse.data.rates.ARS;

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

      const items = response.data.itemSummaries || [];

      const products = items.map(item => ({
          title: item.title,
          price: item.price.value,
          priceARS: (parseFloat(item.price.value) * usdToArsRate).toFixed(2),
          currency: item.price.currency,
          thumbnail: item.image?.imageUrl || null,
          link: item.itemWebUrl
      }));

      const totalPrice = products.reduce((acc, p) => acc + parseFloat(p.price), 0);
      const averagePrice = products.length ? (totalPrice / products.length).toFixed(2) : 0;
      const averagePriceARS = products.length ? (averagePrice * usdToArsRate).toFixed(2) : 0;

      res.json({
          products,
          averagePrice,
          averagePriceARS,
          exchangeRate: usdToArsRate
      });

  } catch (error) {
      console.error('Error al buscar productos:', error.response?.data || error.message);
      res.status(500).json({ error: 'Error al buscar productos', details: error.response?.data || error.message });
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