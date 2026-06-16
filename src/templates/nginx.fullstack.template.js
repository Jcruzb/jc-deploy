const { domainList } = require('../services/nginx.service');
const { normalizeApiPath } = require('../core/validators');

function nginxFullstackTemplate({ domain, includeWww, publicDir, apiPath, port }) {
  const cleanApiPath = normalizeApiPath(apiPath);
  const locationPath = cleanApiPath.endsWith('/') ? cleanApiPath : `${cleanApiPath}/`;

  return `server {
    listen 80;
    server_name ${domainList(domain, includeWww).join(' ')};

    root ${publicDir};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ${locationPath} {
        proxy_pass http://127.0.0.1:${port}${locationPath};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
}

module.exports = {
  nginxFullstackTemplate
};
