// multipart.js
// Minimal multipart/form-data request parser, written against the raw
// Buffer so uploads don't need base64-encoding (which inflates size ~33%)
// and no external "multer"/"busboy" package is required.

function getBoundary(contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) return null;
  return match[1] || match[2];
}

// Returns { fields: {name: value}, files: [{fieldname, filename, contentType, data: Buffer}] }
function parseMultipart(buffer, contentType) {
  const boundary = getBoundary(contentType);
  if (!boundary) throw new Error('Not a multipart/form-data request');
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];

  // Split the buffer on the boundary marker.
  const parts = [];
  let start = buffer.indexOf(boundaryBuf);
  while (start !== -1) {
    const next = buffer.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (next === -1) break;
    // Slice between boundaries, trimming the leading CRLF and trailing CRLF.
    let chunk = buffer.slice(start + boundaryBuf.length, next);
    if (chunk.slice(0, 2).toString() === '\r\n') chunk = chunk.slice(2);
    if (chunk.slice(-2).toString() === '\r\n') chunk = chunk.slice(0, -2);
    if (chunk.length) parts.push(chunk);
    start = next;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = part.slice(0, headerEnd).toString('utf8');
    const body = part.slice(headerEnd + 4);

    const nameMatch = /name="([^"]+)"/i.exec(headerText);
    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
    const fieldname = nameMatch ? nameMatch[1] : null;
    if (!fieldname) continue;

    if (filenameMatch && filenameMatch[1] !== '') {
      files.push({
        fieldname,
        filename: filenameMatch[1],
        contentType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
        data: body,
      });
    } else {
      fields[fieldname] = body.toString('utf8');
    }
  }

  return { fields, files };
}

module.exports = { parseMultipart, getBoundary };
