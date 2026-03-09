import fs from 'fs';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

function trailingSlash(): Plugin {
  return {
    name: 'trailing-slash',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url || '';
        if (!url.endsWith('/') && !url.includes('.') && !url.startsWith('/@')) {
          const dir = '.' + url;
          if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
            req.url = url + '/';
          }
        }
        next();
      });
    },
  };
}

function jsViewer(): Plugin {
  return {
    name: 'js-viewer-rewrite',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url || '';
        if (url.endsWith('.js') && !url.includes('node_modules')) {
          const viewer = path.join('.', url + '.html');
          if (fs.existsSync(viewer)) req.url = url + '.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  appType: 'mpa',
  plugins: [trailingSlash(), jsViewer()],
  build: {
    rollupOptions: {
      input: {
        pub: 'pub/index.html',
        howto: 'pub/howto/index.html',
        priv: 'priv/index.html',
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
});
