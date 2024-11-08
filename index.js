import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Cache mechanism
let cache = {
  data: null,
  lastUpdated: null
};

let newsCache = {
  data: null,
  lastUpdated: null
};

let contestCache = {
  data: null,
  lastUpdated: null
};

const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds
const NEWS_CACHE_DURATION = 1000 * 60 * 10; // 10 minutes
const CONTEST_CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds


async function scrapeHackathons() {
  try {
    const apiUrl = 'https://devpost.com/api/hackathons?challenge_type[]=online&status[]=upcoming&status[]=open';
    
    const response = await axios.get(apiUrl, {
        headers: {
          'accept': '*/*',
          'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
          'if-none-match': 'W/"18355ee10e48704a75d7d2fc2d6723b9"',
          'priority': 'u=1, i',
          'sec-ch-ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Linux"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          'Referer': 'https://devpost.com/hackathons?challenge_type[]=online&status[]=upcoming&status[]=open',
          'Referrer-Policy': 'strict-origin-when-cross-origin'
        }
      });
    
      const hackathons = response.data.hackathons.map(hackathon => ({
        id: hackathon.id,
        title: hackathon.title,
        location: hackathon.displayed_location.location,
        open_state: hackathon.open_state,
        thumbnail_url: hackathon.thumbnail_url,
        url: hackathon.url,
        time_left_to_submission: hackathon.time_left_to_submission,
        submission_period_dates: hackathon.submission_period_dates,
        themes: hackathon.themes.map(theme => theme.name),
        prize_amount: hackathon.prize_amount,
        registrations_count: hackathon.registrations_count,
        featured: hackathon.featured,
        organization_name: hackathon.organization_name,
        winners_announced: hackathon.winners_announced,
        submission_gallery_url: hackathon.submission_gallery_url,
        start_a_submission_url: hackathon.start_a_submission_url,
        invite_only: hackathon.invite_only,
        eligibility_requirement_invite_only_description: hackathon.eligibility_requirement_invite_only_description,
        managed_by_devpost_badge: hackathon.managed_by_devpost_badge
      }));
    
    return hackathons;
  } catch (error) {
    console.error('Scraping error:', error);
    throw error;
  }
}

async function fetchNews() {
  try {
    const response = await axios.get('https://www.developer-tech.com/');
    const news = response.data.map(item => ({
      title: item.title,
      desc: item.desc,
      url: item.url,
      // Add other fields as needed
    }));

    // Update cache
    newsCache = {
      data: news,
      lastUpdated: Date.now()
    };

    return news;
  } catch (error) {
    console.error('Fetching news error:', error);
    throw error;
  }
}

app.get('/api/hackathons', async (req, res) => {
  try {
    // Check if cache is valid
    if (cache.data && cache.lastUpdated && (Date.now() - cache.lastUpdated) < CACHE_DURATION) {
      return res.json(cache.data);
    }

    // If cache is invalid or doesn't exist, scrape new data
    const hackathons = await scrapeHackathons();

    console.log('Fetched new hackathons data');
    
    // Update cache
    cache = {
      data: hackathons,
      lastUpdated: Date.now()
    };
    
    res.json(hackathons);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch hackathons' });
  }
});

app.get('/api/news', async (req, res) => {
  try {
    if (newsCache.data && newsCache.lastUpdated && (Date.now() - newsCache.lastUpdated) < NEWS_CACHE_DURATION) {
      return res.json(newsCache.data);
    }
    const url = 'https://www.developer-tech.com/';
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // Array to hold the scraped articles
    const articles = [];

    $('div.content.home > div.inner-content > main > article').each((i, el) => {
      const title = $(el).find('header.article-header h3 a').text().trim();
      const desc = $(el).find('div.cell.medium-8.large-6 p').first().text().trim();
      const link = $(el).find('header.article-header h3 a').attr('href');
      articles.push({ title, desc, link });
    });
    newsCache = {
      data: articles,
      lastUpdated: Date.now()
    };

    res.json(articles);
  } catch (error) {
    console.error('Error scraping website:', error);
    res.status(500).json({ message: 'Error scraping website' });
  }
});

app.get('/api/contests',async(req,res)=>{
  try {
    if (contestCache.data && contestCache.lastUpdated && (Date.now() - contestCache.lastUpdated) < CONTEST_CACHE_DURATION) {
      return res.json(contestCache.data);
    }
    const response = await fetch(
      "https://competeapi.vercel.app/contests/upcoming"
    );
    const data = await response.json();
    contestCache = {
      data: data,
      lastUpdated: Date.now()
    };

    res.json(data);
  } catch (error) {
    console.error('Error scraping website:', error);
    res.status(500).json({ message: 'Error scraping website' });
  }
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Error handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});



  