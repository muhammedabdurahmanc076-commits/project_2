# StudyShare — no external npm packages, so the image build needs no `npm install`.
FROM node:22-alpine

WORKDIR /app
COPY . .

# Create the uploads directory (also done at runtime, but good to have it baked in).
RUN mkdir -p uploads

EXPOSE 3000
ENV PORT=3000

# Run the seed script only if the database doesn't exist yet, then start the server.
CMD sh -c "[ -f ${DATA_DIR:-.}/studyshare.db ] || node seed.js; node server.js"
