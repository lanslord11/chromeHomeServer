import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDatabase from './config/database.js';
import Note from './models/Note.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const corsOptions = {
  origin: function(origin, callback) {
    // Allow Chrome extension origins and localhost for development
    if (!origin || 
        origin.startsWith('chrome-extension://') || 
        origin === 'http://localhost:5173' ||
        origin === 'http://localhost:3000') {
      callback(null, true);
    } else {
      console.log('Blocked origin:', origin); // For debugging
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'x-user-email'],
  credentials: true,
  optionsSuccessStatus: 200 // Important for preflight requests
};
// Enable CORS
app.use(cors(corsOptions));

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

// Helper: get user email from header or query (extension sends X-User-Email)
const getUserEmail = (req) =>
  req.headers['x-user-email'] || req.query.userEmail || null;

const NOTES_PAGE_LIMIT = 10;

// Notes API (all scoped by user email)
app.get('/api/notes', async (req, res) => {
  try {
    const userEmail = getUserEmail(req);
    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required (X-User-Email header or userEmail query)' });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || NOTES_PAGE_LIMIT));
    const skip = (page - 1) * limit;

    const [notes, total] = await Promise.all([
      Note.find({ userEmail }).sort({ order: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Note.countDocuments({ userEmail }),
    ]);
    const hasMore = skip + notes.length < total;
    res.json({ notes, hasMore, nextPage: hasMore ? page + 1 : null });
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

const NOTES_RATE_LIMIT_PER_DAY = 100;

app.post('/api/notes', async (req, res) => {
  try {
    const userEmail = req.body.userEmail || getUserEmail(req);
    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required' });
    }
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const countLast24h = await Note.countDocuments({
      userEmail,
      createdAt: { $gte: oneDayAgo },
    });
    if (countLast24h >= NOTES_RATE_LIMIT_PER_DAY) {
      return res.status(429).json({
        error: `Rate limit exceeded. Maximum ${NOTES_RATE_LIMIT_PER_DAY} notes per day.`,
      });
    }
    const { title, content } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    const note = await Note.create({ userEmail, title, content: content || '' });
    res.status(201).json(note);
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

app.put('/api/notes/reorder', async (req, res) => {
  try {
    const userEmail = getUserEmail(req);
    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required' });
    }
    const { noteId, newOrder } = req.body;
    if (noteId == null || newOrder == null || typeof newOrder !== 'number') {
      return res.status(400).json({ error: 'noteId and newOrder (number) are required' });
    }
    const note = await Note.findOneAndUpdate(
      { _id: noteId, userEmail },
      { order: newOrder },
      { new: true }
    );
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json({ success: true, note });
  } catch (error) {
    console.error('Error reordering notes:', error);
    res.status(500).json({ error: 'Failed to reorder notes' });
  }
});

app.get('/api/notes/:id', async (req, res) => {
  try {
    const userEmail = getUserEmail(req);
    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required' });
    }
    const note = await Note.findOne({ _id: req.params.id, userEmail });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json(note);
  } catch (error) {
    console.error('Error fetching note:', error);
    res.status(500).json({ error: 'Failed to fetch note' });
  }
});

app.put('/api/notes/:id', async (req, res) => {
  try {
    const userEmail = getUserEmail(req);
    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required' });
    }
    const { title, content } = req.body;
    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, userEmail },
      { ...(title !== undefined && { title }), ...(content !== undefined && { content }) },
      { new: true, runValidators: true }
    );
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json(note);
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

app.delete('/api/notes/:id', async (req, res) => {
  try {
    const userEmail = getUserEmail(req);
    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required' });
    }
    const note = await Note.findOneAndDelete({ _id: req.params.id, userEmail });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.get('/', (req, res) => {
    res.json({ message: 'Welcome to the DevPost API' });
    });

connectDatabase();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Error handling


app.options('*', cors(corsOptions));

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});


export default app;
  

