module.exports = (plugin) => {

  const uploadRoute = plugin.routes['content-api']?.routes?.find(
    (route) => route.method === 'POST' && route.path === '/upload'
  );

  if (uploadRoute) {
    uploadRoute.config = {
      ...uploadRoute.config,
      auth: false,
    };
  }

  return plugin;
};