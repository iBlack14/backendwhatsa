require('dotenv').config();

console.log('=== Testing .env file ===');
console.log('PORT:', process.env.PORT);
console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? 'SET (length: ' + process.env.SUPABASE_SERVICE_KEY.length + ')' : 'NOT SET');
console.log('N8N_UPDATE_WEBHOOK:', process.env.N8N_UPDATE_WEBHOOK);
console.log('FRONTEND_URL:', process.env.FRONTEND_URL);
