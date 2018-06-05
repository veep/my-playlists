
module.exports.my_ts = function () {
  const ts = process.hrtime();
  return Math.round(ts[0]*1e3+ts[1]/1e6);
}

module.exports.get_handlebars_helpers = function () {
  return {
    encode_uri_component: function(foo) {return encodeURIComponent(foo);},
        compare: function (lvalue, operator, rvalue, options) {

      if (arguments.length < 3) {
          throw new Error("Handlerbars Helper 'compare' needs 2 parameters");
      }

      if (options === undefined) {
          options = rvalue;
          rvalue = operator;
          operator = "===";
      }

      let operators = {
          '==': function (l, r) { return l == r; },
          '===': function (l, r) { return l === r; },
          '!=': function (l, r) { return l != r; },
          '!==': function (l, r) { return l !== r; },
          '<': function (l, r) { return l < r; },
          '>': function (l, r) { return l > r; },
          '<=': function (l, r) { return l <= r; },
          '>=': function (l, r) { return l >= r; },
          'typeof': function (l, r) { return typeof l == r; }
      };

      if (!operators[operator]) {
          throw new Error("Handlerbars Helper 'compare' doesn't know the operator " + operator);
      }

      let result = operators[operator](lvalue, rvalue);

      if (result) {
          return options.fn(this);
      } else {
          return options.inverse(this);
      }

    }
  }
}

// From https://stackoverflow.com/questions/37320296/how-to-calculate-intersection-of-multiple-arrays-in-javascript-and-what-does-e
const intersect2 = (xs,ys) => xs.filter(x => ys.some(y => y === x));
const intersect = (xs,ys,...rest) =>  ys === undefined ? xs : intersect(intersect2(xs,ys),...rest);
module.exports.intersect = intersect;