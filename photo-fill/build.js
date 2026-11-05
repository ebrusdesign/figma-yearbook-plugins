// Inlines the layout engine into the plugin UI (Figma plugins load a single ui.html).
// Usage: node build.js
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
fs.writeFileSync(path.join(__dirname, 'ui.html'), src('ui.src.html').replace('/*__LAYOUT__*/', src('layout.js')));
console.log('wrote ui.html');
