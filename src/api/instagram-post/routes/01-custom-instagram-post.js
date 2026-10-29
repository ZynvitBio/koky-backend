// @ts-nocheck
'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/instagram-posts/render-reel',
      handler: 'instagram-post.renderReel',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/instagram-posts/publish-to-instagram',
      handler: 'instagram-post.publishToInstagram',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/instagram-posts/published-recipes',
      handler: 'instagram-post.getPublishedRecipes',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/instagram-posts/sync-instagram',
      handler: 'instagram-post.syncInstagram',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    }
  ],
};
