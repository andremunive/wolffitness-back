'use strict';

/**
 * monthly-client service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::monthly-client.monthly-client');
