const { domainList } = require('../services/nginx.service');

function nginxFrontTemplate({ domain, includeWww, publicDir }) {
  return `server {
    listen 80;
    server_name ${domainList(domain, includeWww).join(' ')};

    root ${publicDir};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
`;
}

module.exports = {
  nginxFrontTemplate
};
