// Standalone browser bundle of the MELEK-patched blurtjs, exposed as window.MelekChain.
// The copy in the condenser node_modules has the fork patches in lib/ (claim_reward_balance
// carrying THREE assets, MELEK/MBD symbols); its prebuilt dist/ predates them, which is why
// the published browser bundle cannot sign this op.
var blurt = require("@blurtfoundation/blurtjs");
module.exports = blurt;
