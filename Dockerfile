FROM node:20-alpine

WORKDIR /app

# Copy all files
COPY . .

# Install dependencies
RUN npm install

# Build
RUN npm run build

# Expose port
EXPOSE 3001

# Start server
CMD ["npm", "start"]
