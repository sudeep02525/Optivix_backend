import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { analyzeCode, generateFix, getSuggestions, checkAIHealth, selfHealCode } from './services/multiAIService.js'
import { fetchWebsiteHtml, analyzeWebsiteHtml, fixWebsiteHtmlSEO } from './services/websiteAuditService.js'

const app = express()
const PORT = process.env.PORT || 5000
const JWT_SECRET = process.env.JWT_SECRET || 'optivix_secret'
const MONGODB_URI = process.env.MONGODB_URI

// ── Connect to MongoDB ────────────────────────────────────────────────────────
mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 30000, // 30 seconds timeout
  socketTimeoutMS: 45000, // 45 seconds socket timeout
})
  .then(() => console.log('✅ MongoDB Atlas connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err))

// ── User Schema with Free Period System ──────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:  { type: String, required: true },
  
  // Plan & Free Period
  plan: { 
    type: String, 
    enum: ['free_period', 'free', 'pro', 'enterprise'], 
    default: 'free_period' 
  },
  freePeriodStartDate: { type: Date, default: Date.now },
  freePeriodEndDate: { 
    type: Date, 
    default: () => Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
  },
  freePeriodActive: { type: Boolean, default: true },
  
  // Usage Tracking (for free plan after period)
  aiUsage: {
    today: { type: Number, default: 0 },
    lastResetDate: { type: Date, default: Date.now },
    totalUsed: { type: Number, default: 0 }
  },
  
  // Limits
  limits: {
    aiAnalysesPerDay: { type: Number, default: 999999 }, // Unlimited during free period
    maxProjects: { type: Number, default: 999999 }
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

const User = mongoose.model('User', userSchema)

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://optivix.vercel.app',
  'https://optivix-frontend.vercel.app',
  process.env.FRONTEND_URL,
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true)
    
    // Check if origin is in allowed list or matches Vercel pattern
    if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true)
    } else {
      console.log('❌ CORS blocked origin:', origin)
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true
}))
app.use(express.json())

// ── Auth Middleware ───────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// ── Check Free Period Status ──────────────────────────────────────────────────
async function checkFreePeriodStatus(req, res, next) {
  try {
    const user = await User.findById(req.user.id)
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    // Check if free period expired
    if (user.plan === 'free_period' && new Date() > user.freePeriodEndDate) {
      user.plan = 'free'
      user.freePeriodActive = false
      user.limits.aiAnalysesPerDay = 10
      user.limits.maxProjects = 3
      await user.save()
      req.freePeriodExpired = true
    }
    
    // Reset daily usage for free plan users (midnight reset)
    if (user.plan === 'free') {
      const today = new Date().toDateString()
      const lastReset = new Date(user.aiUsage.lastResetDate).toDateString()
      
      if (today !== lastReset) {
        user.aiUsage.today = 0
        user.aiUsage.lastResetDate = new Date()
        await user.save()
      }
    }
    
    req.user.fullData = user
    next()
  } catch (error) {
    console.error('Free period check error:', error)
    res.status(500).json({ error: 'Server error' })
  }
}

// ── Check AI Usage Limits ─────────────────────────────────────────────────────
async function checkAIUsage(req, res, next) {
  try {
    const user = req.user.fullData
    
    // No limits for free_period, pro, or enterprise
    if (['free_period', 'pro', 'enterprise'].includes(user.plan)) {
      return next()
    }
    
    // Check limits for free plan
    if (user.plan === 'free' && user.aiUsage.today >= user.limits.aiAnalysesPerDay) {
      // Calculate time until reset (midnight)
      const now = new Date()
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(0, 0, 0, 0)
      const hoursUntilReset = Math.ceil((tomorrow - now) / (1000 * 60 * 60))
      
      return res.status(429).json({ 
        error: 'Daily limit reached',
        message: `You've used all ${user.limits.aiAnalysesPerDay} AI analyses today. Resets in ${hoursUntilReset} hours.`,
        limit: user.limits.aiAnalysesPerDay,
        used: user.aiUsage.today,
        resetIn: hoursUntilReset,
        upgradeUrl: '/payment?plan=pro'
      })
    }
    
    next()
  } catch (error) {
    console.error('Usage check error:', error)
    res.status(500).json({ error: 'Server error' })
  }
}

// ── Increment AI Usage ────────────────────────────────────────────────────────
async function incrementAIUsage(userId, plan) {
  if (plan === 'free') {
    await User.findByIdAndUpdate(userId, {
      $inc: { 
        'aiUsage.today': 1,
        'aiUsage.totalUsed': 1
      }
    })
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => res.json({ status: 'Optivix Backend running', version: '1.0.0' }))

// AI Health check
app.get('/api/ai/health', async (req, res) => {
  try {
    const health = await checkAIHealth()
    res.json({ 
      status: 'ok',
      models: health,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    res.status(500).json({ error: 'Health check failed' })
  }
})

// Register with Free Period
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body
    if (!name || !email || !password)
      return res.status(400).json({ error: 'All fields required' })
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' })

    const existing = await User.findOne({ email })
    if (existing) return res.status(409).json({ error: 'Email already registered' })

    const hashedPassword = await bcrypt.hash(password, 10)
    
    // Create user with 30-day free period
    const freePeriodEndDate = new Date()
    freePeriodEndDate.setDate(freePeriodEndDate.getDate() + 30)
    
    const user = await User.create({ 
      name, 
      email, 
      password: hashedPassword,
      plan: 'free_period',
      freePeriodStartDate: new Date(),
      freePeriodEndDate: freePeriodEndDate,
      freePeriodActive: true,
      limits: {
        aiAnalysesPerDay: 999999, // Unlimited during free period
        maxProjects: 999999
      }
    })

    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email, plan: user.plan },
      JWT_SECRET,
      { expiresIn: '30d' }
    )
    
    res.status(201).json({ 
      token, 
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email,
        plan: user.plan,
        freePeriodEndDate: user.freePeriodEndDate,
        freePeriodActive: user.freePeriodActive
      },
      message: '🎉 Welcome! You have 30 days of unlimited AI access!'
    })
  } catch (err) {
    console.error('Register error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' })

    const user = await User.findOne({ email })
    if (!user) return res.status(401).json({ error: 'Invalid email or password' })

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' })

    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    )
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Get current user
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password')
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json({ user })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Logout
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  res.json({ message: 'Logged out successfully' })
})

// ── AI Routes ─────────────────────────────────────────────────────────────────

// Analyze code with AI
app.post('/api/ai/analyze', authMiddleware, checkFreePeriodStatus, checkAIUsage, async (req, res) => {
  try {
    const { code, language } = req.body
    
    if (!code) {
      return res.status(400).json({ error: 'Code is required' })
    }

    const user = req.user.fullData

    // Perform AI analysis
    const result = await analyzeCode(code, language || 'javascript')
    
    // Increment usage for free plan
    await incrementAIUsage(req.user.id, user.plan)
    
    // Get updated user data
    const updatedUser = await User.findById(req.user.id)
    
    // Calculate days/hours remaining
    let daysRemaining = 0
    let hoursRemaining = 0
    if (user.plan === 'free_period') {
      const now = new Date()
      const endDate = new Date(user.freePeriodEndDate)
      const diffTime = endDate - now
      daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      hoursRemaining = Math.ceil(diffTime / (1000 * 60 * 60))
    }
    
    // Calculate reset time for free plan
    let resetIn = 0
    if (user.plan === 'free') {
      const now = new Date()
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(0, 0, 0, 0)
      resetIn = Math.ceil((tomorrow - now) / (1000 * 60 * 60))
    }
    
    res.json({
      ...result,
      userStatus: {
        plan: updatedUser.plan,
        freePeriodActive: updatedUser.freePeriodActive,
        daysRemaining: daysRemaining,
        hoursRemaining: hoursRemaining,
        usage: updatedUser.plan === 'free' ? {
          today: updatedUser.aiUsage.today,
          limit: updatedUser.limits.aiAnalysesPerDay,
          remaining: updatedUser.limits.aiAnalysesPerDay - updatedUser.aiUsage.today,
          resetIn: resetIn
        } : null
      },
      message: req.freePeriodExpired ? 
        '⚠️ Your free period has ended. You are now on the Free plan with 10 AI analyses per day.' : 
        null
    })
  } catch (error) {
    console.error('Analyze error:', error)
    res.status(500).json({ error: 'Failed to analyze code' })
  }
})

// Generate fix with AI
app.post('/api/ai/fix', authMiddleware, checkFreePeriodStatus, checkAIUsage, async (req, res) => {
  try {
    const { code, issue, language } = req.body
    
    if (!code || !issue) {
      return res.status(400).json({ error: 'Code and issue are required' })
    }

    const user = req.user.fullData
    
    const result = await generateFix(code, issue, language || 'javascript')
    
    await incrementAIUsage(req.user.id, user.plan)
    
    res.json({
      fixedCode: result.fixedCode,
      aiModel: result.aiModel,
    })
  } catch (error) {
    console.error('Fix error:', error)
    res.status(500).json({ error: 'Failed to generate fix' })
  }
})

// Self-heal production-style crash
app.post('/api/ai/self-heal', authMiddleware, checkFreePeriodStatus, checkAIUsage, async (req, res) => {
  try {
    const { code, error, language } = req.body
    if (!code || !error) {
      return res.status(400).json({ error: 'Code and error message are required' })
    }
    const user = req.user.fullData
    const result = await selfHealCode(code, error, language || 'javascript')
    await incrementAIUsage(req.user.id, user.plan)
    res.json(result)
  } catch (error) {
    console.error('Self-heal error:', error)
    res.status(500).json({ error: 'Self-heal failed' })
  }
})

// Website audit (server fetch — no CORS)
app.post('/api/ai/website-audit', authMiddleware, checkFreePeriodStatus, checkAIUsage, async (req, res) => {
  try {
    const { url } = req.body
    if (!url) return res.status(400).json({ error: 'URL is required' })
    const user = req.user.fullData
    const { html, url: finalUrl } = await fetchWebsiteHtml(url)
    const report = analyzeWebsiteHtml(html, finalUrl)
    await incrementAIUsage(req.user.id, user.plan)
    res.json({ html, url: finalUrl, ...report })
  } catch (error) {
    console.error('Website audit error:', error)
    res.status(500).json({ error: error.message || 'Website audit failed' })
  }
})

// Apply SEO fixes to HTML
app.post('/api/ai/website-fix-seo', authMiddleware, checkFreePeriodStatus, checkAIUsage, async (req, res) => {
  try {
    const { html } = req.body
    if (!html) return res.status(400).json({ error: 'HTML is required' })
    const user = req.user.fullData
    const { fixed, log } = fixWebsiteHtmlSEO(html)
    await incrementAIUsage(req.user.id, user.plan)
    res.json({ fixedHtml: fixed, log })
  } catch (error) {
    console.error('Website SEO fix error:', error)
    res.status(500).json({ error: 'Failed to fix SEO' })
  }
})

// Get AI suggestions
app.post('/api/ai/suggest', authMiddleware, checkFreePeriodStatus, checkAIUsage, async (req, res) => {
  try {
    const { code, language } = req.body
    
    if (!code) {
      return res.status(400).json({ error: 'Code is required' })
    }

    const user = req.user.fullData
    
    // Get suggestions
    const suggestions = await getSuggestions(code, language || 'javascript')
    
    // Increment usage for free plan
    await incrementAIUsage(req.user.id, user.plan)
    
    res.json({ suggestions })
  } catch (error) {
    console.error('Suggestions error:', error)
    res.status(500).json({ error: 'Failed to get suggestions' })
  }
})

// Get user status
app.get('/api/user/status', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password')
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    // Calculate days/hours remaining
    let daysRemaining = 0
    let hoursRemaining = 0
    
    if (user.plan === 'free_period') {
      const now = new Date()
      const endDate = new Date(user.freePeriodEndDate)
      const diffTime = endDate - now
      daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      hoursRemaining = Math.ceil(diffTime / (1000 * 60 * 60))
      
      // If expired, downgrade
      if (daysRemaining <= 0) {
        user.plan = 'free'
        user.freePeriodActive = false
        user.limits.aiAnalysesPerDay = 10
        user.limits.maxProjects = 3
        await user.save()
      }
    }
    
    // Calculate reset time for free plan
    let resetIn = 0
    if (user.plan === 'free') {
      const now = new Date()
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(0, 0, 0, 0)
      resetIn = Math.ceil((tomorrow - now) / (1000 * 60 * 60))
    }
    
    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        freePeriodActive: user.freePeriodActive,
        freePeriodEndDate: user.freePeriodEndDate,
        daysRemaining: daysRemaining,
        hoursRemaining: hoursRemaining,
        limits: user.limits,
        usage: user.plan === 'free' ? {
          ...user.aiUsage,
          resetIn: resetIn
        } : null
      }
    })
  } catch (error) {
    console.error('Status error:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

// Upgrade to Pro
app.post('/api/user/upgrade', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body
    
    if (!['pro', 'enterprise'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' })
    }
    
    const user = await User.findById(req.user.id)
    
    user.plan = plan
    user.limits.aiAnalysesPerDay = 999999 // Unlimited
    user.limits.maxProjects = 999999
    await user.save()
    
    res.json({
      message: 'Successfully upgraded!',
      plan: user.plan,
      limits: user.limits
    })
  } catch (error) {
    console.error('Upgrade error:', error)
    res.status(500).json({ error: 'Failed to upgrade' })
  }
})

app.listen(PORT, () => console.log(`🚀 Optivix Backend running on http://localhost:${PORT}`))
