import { defineEventHandler } from 'h3';

// Health check endpoint
export default defineEventHandler(() => {
  return {
    status: 'ok',
    timestamp: Date.now(),
  };
});
