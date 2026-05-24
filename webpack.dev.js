const { merge } = require('webpack-merge');

const common = require('./webpack.common');

module.exports = merge(common, {
    // In order for live reload to work we must use "web" as the target not "browserslist"
    target: process.env.WEBPACK_SERVE ? 'web' : 'browserslist',
    mode: 'development',
    devtool: 'eval-cheap-module-source-map',
    module: {
        rules: [
            {
                test: /\.(js|jsx|ts|tsx)$/,
                exclude: /node_modules/,
                enforce: 'pre',
                use: ['source-map-loader']
            }
        ]
    },
    devServer: {
        compress: true,
        client: {
            overlay: {
                errors: true,
                warnings: false
            }
        },
        proxy: [
            {
                context: (pathname) => {
                    // Deixa passar apenas assets estáticos do webpack
                    const staticPaths = [
                        '/main.', '/themes/', '/libraries/', '/assets/',
                        '/favicons/', '/manifest.json', '/config.json',
                        '/robots.txt', '/sockjs-node', '/__webpack',
                        '/ws'  // webpack-dev-server HMR WebSocket — must NOT be proxied to Jellyfin
                    ];
                    return !staticPaths.some(p => pathname.startsWith(p));
                },
                target: 'http://localhost:8096',
                changeOrigin: true,
                ws: true,
                onError: (err, req, res) => {
                    // Silencia erros de proxy para não travar o HMR
                }
            }
        ]
    }
});
