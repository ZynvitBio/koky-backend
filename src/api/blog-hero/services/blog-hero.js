'use strict';

/**
 * blog-hero service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::blog-hero.blog-hero');
