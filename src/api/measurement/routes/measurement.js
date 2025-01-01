"use strict";

/**
 * measurement router
 */

// @ts-ignore
const { createCoreRouter } = require("@strapi/strapi").factories;

module.exports = createCoreRouter("api::measurement.measurement");
