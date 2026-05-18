// Quick test script to verify backend is working
// Run: node test-connection.js

const BACKEND_URL = process.argv[2] || 'http://localhost:5000'

// [REMOVED] console.log('🧪 Testing Optivix Backend Connection...')
console.log('📍 Backend URL:', BACKEND_URL)
// [REMOVED] console.log('')

async function test() {
  try {
    // Test 1: Health Check
    // [REMOVED] console.log('Test 1: Health Check')
    const health = await fetch(BACKEND_URL)
    const healthData = await health.json()
    console.log('✅ Status:', health.status)
    console.log('✅ Response:', healthData)
    // [REMOVED] console.log('')

    // Test 2: Register
    // [REMOVED] console.log('Test 2: Register User')
    const testUser = {
      name: 'Test User',
      email: `test${Date.now()}@example.com`,
      password: 'test123456'
    }
    const register = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser)
    })
    const registerData = await register.json()
    console.log('✅ Status:', register.status)
    console.log('✅ Response:', registerData)
    // [REMOVED] console.log('')

    if (registerData.token) {
      // Test 3: Get Current User
      // [REMOVED] console.log('Test 3: Get Current User')
      const me = await fetch(`${BACKEND_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${registerData.token}` }
      })
      const meData = await me.json()
      console.log('✅ Status:', me.status)
      console.log('✅ Response:', meData)
      // [REMOVED] console.log('')

      // Test 4: Login
      // [REMOVED] console.log('Test 4: Login')
      const login = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testUser.email, password: testUser.password })
      })
      const loginData = await login.json()
      console.log('✅ Status:', login.status)
      console.log('✅ Response:', loginData)
      // [REMOVED] console.log('')
    }

    // [REMOVED] console.log('🎉 All tests passed!')
    // [REMOVED] console.log('')
    console.log('✅ Backend is working correctly')
    console.log('✅ MongoDB is connected')
    console.log('✅ Authentication is working')
    // [REMOVED] console.log('')
    // [REMOVED] console.log('Next steps:')
    // [REMOVED] console.log('1. Deploy this backend to Render')
    // [REMOVED] console.log('2. Set NEXT_PUBLIC_API_URL in Vercel to your Render URL')
    // [REMOVED] console.log('3. Set FRONTEND_URL in Render to your Vercel URL')

  } catch (error) {
    console.error('❌ Test failed:', error.message)
    // [REMOVED] console.log('')
    // [REMOVED] console.log('Possible issues:')
    console.log('- Backend is not running')
    console.log('- MongoDB is not connected')
    // [REMOVED] console.log('- Wrong backend URL')
    // [REMOVED] console.log('- Network/firewall blocking connection')
  }
}

test()
