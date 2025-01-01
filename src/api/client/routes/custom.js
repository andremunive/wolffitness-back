module.exports = {
  routes: [
    {
      method: "GET",
      path: "/trainer/:name",
      handler: "client.findByTrainer",
    },
  ],
};
