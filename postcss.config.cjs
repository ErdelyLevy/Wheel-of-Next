module.exports = {
  plugins: [
    require("postcss-sorting")({
      order: [
        "custom-properties",
        "dollar-variables",
        "declarations",
        "rules",
        "at-rules"
      ],
      "properties-order": "alphabetical",
      "rules-order": "alphabetical",
      "unspecified-properties-position": "bottom"
    })
  ]
};
