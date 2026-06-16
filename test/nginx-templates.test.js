const test = require('node:test');
const assert = require('node:assert/strict');
const { nginxFrontTemplate } = require('../src/templates/nginx.front.template');
const { nginxBackTemplate } = require('../src/templates/nginx.back.template');

test('nginx templates include expected frontend and backend directives', () => {
  const front = nginxFrontTemplate({ domain: 'app.example.com', includeWww: false, publicDir: '/var/www/app' });
  assert.match(front, /server_name app\.example\.com;/);
  assert.match(front, /try_files \$uri \$uri\/ \/index\.html;/);

  const back = nginxBackTemplate({ domain: 'api.example.com', port: 3000 });
  assert.match(back, /server_name api\.example\.com;/);
  assert.match(back, /proxy_pass http:\/\/127\.0\.0\.1:3000;/);
  assert.match(back, /proxy_set_header Host \$host;/);
  assert.match(back, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
});
