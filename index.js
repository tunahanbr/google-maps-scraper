const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function getCoordinates(city, country) {
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: `${city}, ${country}`,
        format: 'json',
        limit: 1
      }
    });
    const data = response.data[0];
    if (data) {
      return { lat: parseFloat(data.lat), lon: parseFloat(data.lon) };
    } else {
      throw new Error('Location not found');
    }
  } catch (error) {
    console.error('Error fetching coordinates:', error);
    return { lat: 0, lon: 0 }; // Default or handle error
  }
}

function calculateZoomLevel(radiusKm) {
  // This is an approximation. Adjust as needed.
  return Math.round(14 - Math.log(radiusKm) / Math.log(2));
}

async function scrapeData(industry, city, country, radiusKm) {
  console.log('Starting the scraping process...');

  const { lat: centerLat, lon: centerLon } = await getCoordinates(city, country);

  if (centerLat === 0 && centerLon === 0) {
    console.error('Location not found.');
    return;
  }

  const zoomLevel = calculateZoomLevel(radiusKm);

  // Construct the URL dynamically with center coordinates, zoom level, and search radius
  const url = `https://www.google.com/maps/search/${encodeURIComponent(industry)}+in+${encodeURIComponent(city)}+${encodeURIComponent(country)}/@${centerLat},${centerLon},${zoomLevel}z`;
  console.log(`Scraping URL: ${url}`);

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  try {
    console.log('Navigating to URL...');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

    console.log('Waiting for consent button...');
    try {
      const consentButton = await page.waitForSelector('button[aria-label="Alle akzeptieren"]', { timeout: 10000 });
      if (consentButton) {
        console.log('Consent button found, clicking...');
        await consentButton.click();
        await page.waitForNavigation({ waitUntil: 'networkidle0' });
        console.log('Consent button clicked.');
      } else {
        console.log('Consent button not found. Check selector or page state.');
      }
    } catch (e) {
      console.log('Consent button not found or already accepted.');
    }

    // Wait for the results to load
    await page.waitForSelector('div[aria-label^="Ergebnisse für"]', { timeout: 30000 });

    const scrollContainer = async () => {
      const containerSelector = 'div[aria-label^="Ergebnisse für"]';
      try {
        const container = await page.$(containerSelector);
        if (!container) {
          console.log('Scrollable container not found.');
          return;
        }

        let previousHeight = 0;
        let currentHeight = await page.evaluate(container => container.scrollHeight, container);
        
        while (previousHeight !== currentHeight) {
          previousHeight = currentHeight;
          await page.evaluate(container => container.scrollTo(0, container.scrollHeight), container);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for new content to load
          currentHeight = await page.evaluate(container => container.scrollHeight, container);
          console.log(`Scrolled. Current Height: ${currentHeight}`);
        }
        console.log('Finished scrolling.');
      } catch (error) {
        console.error('Error during scrolling:', error);
      }
    };

    console.log('Scrolling to load all businesses...');
    await scrollContainer();

    const businesses = await page.evaluate(() => {
      const results = [];
      const businessContainers = document.querySelectorAll('div.UaQhfb.fontBodyMedium');

      businessContainers.forEach(el => {
        try {
          const name = el.querySelector('div.qBF1Pd.fontHeadlineSmall')?.textContent.trim() || '';
          const rating = el.querySelector('span.MW4etd')?.textContent.trim() || '';
          const reviews = el.querySelector('span.UY7F9')?.textContent.replace(/[()]/g, '').trim() || '';
          const industry = el.querySelector('div.W4Efsd > div:nth-child(1) > span > span')?.textContent.trim() || '';
          const address = el.querySelector('div.W4Efsd > div:nth-child(1) > span:nth-child(3)')?.textContent.trim() || '';
          const status = el.querySelector('div.W4Efsd > div:nth-child(2) > span:nth-child(1)')?.textContent.trim() || '';
          const phone = el.querySelector('span.UsdlK')?.textContent.trim() || '';

          results.push({
            name,
            rating,
            reviews,
            industry,
            address,
            status,
            phone
          });
        } catch (error) {
          console.error('Error extracting data from container:', error);
        }
      });
      return results.filter(business => business.name !== ''); // Filter out empty entries
    });

    console.log(`Extracted ${businesses.length} businesses.`);

    const fileName = `${industry.replace(/\s+/g, '_')}_${city.replace(/\s+/g, '_')}_${country.replace(/\s+/g, '_')}_${radiusKm}km.json`;
    const filePath = path.join(__dirname, fileName);
    fs.writeFileSync(filePath, JSON.stringify(businesses, null, 2), 'utf8');
    console.log(`Data saved to ${filePath}`);

  } catch (error) {
    console.error('Error scraping the data:', error);
  } finally {
    await browser.close();
  }
}

// Example usage
const industry = 'softwareentwickler-herstellung';
const city = 'Wels';
const country = 'Austria';
const radiusKm = 100; // Radius in kilometers
scrapeData(industry, city, country, radiusKm);