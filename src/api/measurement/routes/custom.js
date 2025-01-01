module.exports = {
  routes: [
    {
      method: "GET",
      path: "/last-three-measurements/:clientId",
      handler: "measurement.lastThree",
    },
  ],
};
