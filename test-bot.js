const https = require('https');

// ===== CONFIG =====
const TOKEN = '8388030544:AAFLRkGqZXBLfqvwxNrPffHNNkWsHTr8980';
const CHAT_ID = '-5212632502'; // chat_id group của bạn

// ===== MESSAGE =====
const message = 'Test bot OK 🚀';

const data = JSON.stringify({
    chat_id: CHAT_ID,
    text: message
});

const options = {
    hostname: 'api.telegram.org',
    path: `/bot${TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data) // FIX ở đây
    }
};

const req = https.request(options, (res) => {
    let body = '';

    console.log('Status:', res.statusCode);

    res.on('data', chunk => body += chunk);
    res.on('end', () => console.log('Response:', body));
});

req.on('error', (e) => console.error('Error:', e));

req.write(data);
req.end();