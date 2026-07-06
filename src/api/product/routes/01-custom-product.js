module.exports = {
  routes: [
    {
      method: "GET",
      path: "/products/facebook-feed",
      handler: "product.facebookFeed",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
