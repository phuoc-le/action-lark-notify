module.exports = {
  "commit-msg": "pnpx commitlint --edit ${1}",
  "pre-commit": "pnpx lint-staged && pnpm run build",
};
