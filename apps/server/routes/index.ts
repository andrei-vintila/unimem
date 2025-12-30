// Root route handler
export default defineEventHandler(() => {
  return {
    name: 'Unimem Sync Server',
    version: '0.1.0',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  };
});
