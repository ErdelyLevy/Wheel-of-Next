module.exports = {
  plugins: [
    {
      postcssPlugin: "blank-lines",
      Once(root) {
        root.walk((node) => {
          if (node.type === "comment" || node.type === "rule") {
            if (node.raws.before && !node.raws.before.startsWith("\n\n")) {
              node.raws.before = "\n\n" + node.raws.before.replace(/^\n+/, "");
            }
          }
        });
      },
    },
  ],
};
