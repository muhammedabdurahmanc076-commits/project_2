// storage.js
// File storage abstraction. Today this is local disk; for production,
// swap the implementation of these two functions for an S3 (or GCS/Azure
// Blob) client and nothing else in the codebase needs to change —
// server.js only ever calls storage.save() and storage.readStream()/read().

const fs = require('fs');
const path = require('path');
const config = require('./config');

const UPLOADS_DIR = path.join(config.DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function save(buffer, safeName) {
  const diskPath = path.join(UPLOADS_DIR, safeName);
  fs.writeFileSync(diskPath, buffer);
  return safeName; // this "key" is what gets stored in the database
}

function read(key) {
  return fs.readFileSync(path.join(UPLOADS_DIR, key));
}

function exists(key) {
  return fs.existsSync(path.join(UPLOADS_DIR, key));
}

function remove(key) {
  const p = path.join(UPLOADS_DIR, key);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

module.exports = { save, read, exists, remove, UPLOADS_DIR };

/*
  --- Swapping to S3 (production) ---
  const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: process.env.AWS_REGION });

  async function save(buffer, safeName) {
    await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: safeName, Body: buffer }));
    return safeName;
  }
  async function read(key) {
    const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    return obj.Body; // stream
  }
  module.exports = { save, read, ... };
*/
