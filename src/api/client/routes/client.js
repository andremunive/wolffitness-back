"use strict";

// @ts-ignore
const { createCoreRouter } = require("@strapi/strapi").factories;

module.exports = createCoreRouter("api::client.client", {
  routes: [
    {
      method: "GET",
      path: "/trainer",
      handler: "client.findByTrainer",
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
});
