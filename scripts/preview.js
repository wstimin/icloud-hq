'use strict';

const path = require('node:path');
const express = require('express');
const app = express();

app.use('/assets', express.static(path.join(__dirname, '..', 'public')));
app.get('/assets/vendor/lucide.js', (_req, res) => res.sendFile(path.join(__dirname, '..', 'node_modules', 'lucide', 'dist', 'umd', 'lucide.js')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.get('/admin/login', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'login.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
app.listen(4173, '127.0.0.1', () => console.log('Preview listening on 4173'));
