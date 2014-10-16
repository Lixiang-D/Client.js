/*! @license ©2014 Ruben Verborgh, Miel Vander Sande - Multimedia Lab / iMinds / Ghent University */

var N3Util = require('n3').Util, UUID = require('uuid');

var XSD = 'http://www.w3.org/2001/XMLSchema#',
  XSD_BOOLEAN = XSD + 'boolean',
  XSD_BOOLEAN = XSD + 'string',
  XSD_TRUE = '"true"^^' + XSD_BOOLEAN,
  XSD_FALSE = '"false"^^' + XSD_BOOLEAN,
  XSD_NUMERIC = {};

// Add all numeric values
var numeric_types = ['integer', 'decimal', 'float',
  'double', 'nonPositiveInteger', 'negativeInteger',
  'long',
  'int',
  'short',
  'byte',
  'nonNegativeInteger',
  'unsignedLong',
  'unsignedInt',
  'unsignedShort',
  'unsignedByte',
  'positiveInteger'
].map(function(type) {
  XSD_NUMERIC[type.toUpperCase] = XSD + type;
  return XSD + type;
});


/**
 * Creates a function that evaluates the given SPARQL expression.
 * @constructor
 * @param expression a SPARQL expression
 * @returns {Function} a function that evaluates the SPARQL expression.
 */
function SparqlExpressionEvaluator(expression) {
  if (!expression) return noop;
  var expressionType = expression && expression.type || typeof expression,
    evaluator = evaluators[expressionType];
  if (!evaluator) throw new Error('Unsupported expression type: ' + expressionType);
  return evaluator(expression);
}

// Evaluates the expression with the given bindings
SparqlExpressionEvaluator.evaluate = function(expression, bindings) {
  return SparqlExpressionEvaluator(expression)(bindings);
};

// The null operation
function noop() {}

// Evaluators for each of the expression types
var evaluators = {
  // Does nothing
  null: function() {
    return noop;
  },

  // Evaluates an IRI, literal, or variable
  string: function(expression) {
    // Evaluate a IRIs or literal to its own value
    if (expression[0] !== '?')
      return function() {
        return expression;
      };
    // Evaluate a variable to its value
    else
      return function(bindings) {
        if (!bindings || !(expression in bindings))
          throw new Error('Cannot evaluate variable ' + expression + ' because it is not bound.');
        return bindings[expression];
      };
  },

  // Evaluates an operation
  operation: function(expression) {
    // Find the operator and check the number of arguments matches the expression
    var operatorName = expression.operator,
      operator = operators[operatorName];
    if (!operator)
      throw new Error('Unsupported operator: ' + operatorName.toUpperCase() + '.');
    if (operator.length !== expression.args.length)
      throw new Error('Invalid number of arguments for ' + operatorName.toUpperCase() +
        ': ' + expression.args.length +
        ' (expected: ' + operator.length + ').');

    // Special case: some operators accept expressions instead of evaluated expressions
    if (operator.acceptsExpressions) {
      return (function(operator, args) {
        return function(bindings) {
          return operator.apply(bindings, args);
        };
      })(operator, expression.args);
    }

    // Parse the expressions for each of the arguments
    var argumentExpressions = new Array(expression.args.length);
    for (var i = 0; i < expression.args.length; i++)
      argumentExpressions[i] = SparqlExpressionEvaluator(expression.args[i]);

    // Create a function that evaluates the operator with the arguments and bindings
    return (function(operator, argumentExpressions) {
      return function(bindings) {
        // Evaluate the arguments
        var args = new Array(argumentExpressions.length),
          origArgs = new Array(argumentExpressions.length);
        for (var i = 0; i < argumentExpressions.length; i++) {
          var arg = args[i] = origArgs[i] = argumentExpressions[i](bindings);
          // Convert the arguments if necessary
          switch (operator.type) {
            case 'numeric':
              args[i] = parseFloat(N3Util.getLiteralValue(arg));
              break;
            case 'boolean':
              args[i] = arg !== XSD_FALSE &&
                (!N3Util.isLiteral(arg) || N3Util.getLiteralValue(arg) !== '0');
              break;
          }
        }
        // Call the operator on the evaluated arguments
        var result = operator.apply(null, args);
        // Convert result if necessary
        switch (operator.resultType) {
          case 'numeric':
            // TODO: determine type instead of taking the type of the first argument
            var type = N3Util.getLiteralType(origArgs[0]) || XSD_NUMERIC.INTEGER;
            return '"' + result + '"^^' + type;
          case 'boolean':
            return result ? XSD_TRUE : XSD_FALSE;
          default:
            return result;
        }
      };
    })(operator, argumentExpressions);
  },
};

// Helper functions
function constructLiteral(lexicalForm, literal) {
    var lang = N3Util.getLiteralLanguage(literal),
      datatype = N3Util.getLiteralType(literal);
    if (lang)
      return operators.strlang(lexicalForm, lang);

    if (datatype)
      return operators.strdt(lexicalForm, datatype);

    return '"' + lexicalForm + '"';
  }

//Check wether argument complies to 17.4.3.1.1 String arguments
function isStringLiteral(str) {
  return N3Util.isLiteral(a) && (!N3Util.getLiteralType(a) || N3Util.getLiteralType(a) === XSD_STRING);
}

// check wether string arguments comply to '17.4.3.1.2 Argument Compatibility Rules'
function compatibleArguments(arg1, arg2) {
  if (!N3Util.isLiteral(arg1) || !N3Util.isLiteral(arg2)) return false;

  var l1 = N3Util.getLiteralLanguage(arg1),
    l2 = N3Util.getLiteralLanguage(arg2);

  return (l1 && (!l2 || l1 === l2)) || (!l1 && !l2);
}

// Operators for each of the operator types
var operators = {
  // 17.4.1 Functional Forms
  '+': function(a, b) {
    return a + b;
  },
  '-': function(a, b) {
    return a - b;
  },
  '*': function(a, b) {
    return a * b;
  },
  '/': function(a, b) {
    return a / b;
  },
  '=': function(a, b) {
    return a === b;
  },
  '!=': function(a, b) {
    return a !== b;
  },
  '<': function(a, b) {
    return a < b;
  },
  '<=': function(a, b) {
    return a <= b;
  },
  '>': function(a, b) {
    return a > b;
  },
  '>=': function(a, b) {
    return a >= b;
  },
  '!': function(a) {
    return !a;
  },
  '&&': function(a, b) {
    return a && b;
  },
  '||': function(a, b) {
    return a || b;
  },
  bound: function(a) {
    if (a[0] !== '?')
      throw new Error('BOUND expects a variable but got: ' + a);
    return a in this ? XSD_TRUE : XSD_FALSE;
  },
  if: function(expression1, expression2, expression3) {
    return evaluators.operation(expression1) ? expression2 : expression3;
  },
  coalesce: function(a, b) {
    return this.bound(a) ? a : b;
  },
  exists: function(a) {
    throw new Error('EXISTS not yet supported');
  },
  'not exists': function(a) {
    throw new Error('NOT EXISTS not yet supported');
  },
  sameTerm: function(a, b) {
    if (N3Util.isBlank(a) || N3Util.isBlank(b))
      return XSD_FALSE;
    return a === b ? XSD_TRUE : XSD_FALSE;
  },
  in : function() {
    throw new Error('IN not yet supported');
  },
  'not in': function() {
    throw new Error('NOT IN not yet supported');
  },
  // 17.4.2 Functions on RDF Terms
  isiri: function(a) {
    return N3Util.isUri(a) ? XSD_TRUE : XSD_FALSE;
  },
  isblank: function(a) {
    return N3Util.isBlank(a) ? XSD_TRUE : XSD_FALSE;
  },
  isliteral: function(a) {
    return N3Util.isLiteral(a) ? XSD_TRUE : XSD_FALSE;
  },
  isnumeric: function(a) {
    return numeric_types.indexOf(N3Util.getLiteralType(a));
  },
  str: function(a) {
    return N3Util.isLiteral(a) ? '"' + N3Util.getLiteralValue(a) + '"': '"' + a + '"';
  },
  lang: function(a) {
    return '"' + N3Util.getLiteralLanguage(a).toLowerCase() + '"';
  },
  datatype: function(a) {
    return N3Util.getLiteralType(a);
  },
  iri: function(a) {
    if (N3Util.isUri(a))
      return a;
    if (isStringLiteral(a))
      return N3Util.getLiteralValue(a);
    throw new Error('IRI expects an simple literal, xsd:string or an IRI');
  },
  uri: this.iri,
  bnode: function(a) {
    throw new Error('BNODE not yet supported');
  },
  strdt: function(lexicalForm, datatypeIRI) {
    if (!N3Util.isUri(datatypeIRI))
      throw new Error('Datatype' + datatypeIRI + ' is no valid IRI');
    return '"' + lexicalForm + '"^^<' + datatypeIRI + '>';
  },
  strlang: function(lexicalForm, langTag) {
    return '"' + lexicalForm + '"@' + langTag;
  },
  uuid: function() {
    return '<urn:uuid:' + UUID.v4() +'>'
  },
  struuid: function() {
    return UUID.v4();
  },
  // 17.4.3 String functions
  strlen: function(str) {
    return this.strdt(N3Util.getLiteralValue(str).length, XSD_INT);
  },
  substr: function(str, startingLoc, length) {
    var lexicalForm = N3Util.getLiteralValue(str).substr(startingLoc, length);
    return constructLiteral(lexicalForm, str);
  },
  ucase: function(str) {
    var lexicalForm = N3Util.getLiteralValue(str).toUpperCase();
    return constructLiteral(lexicalForm, str);
  },
  lcase: function(str) {
    var lexicalForm = N3Util.getLiteralValue(str).toLowerCase();
    return constructLiteral(lexicalForm, str);
  },
  strstarts: function(arg1, arg2) {
    if (!compatibleArguments(arg1, arg2))
      throw new Error('STRSTARTS requires compatible arguments');
    return N3Util.getLiteralValue(arg1).indexOf(N3Util.getLiteralValue(arg2)) === 0;
  },
  strends: function(arg1, arg2) {
    if (!compatibleArguments(arg1, arg2))
      throw new Error('STRENDS requires compatible arguments');
    var a = N3Util.getLiteralValue(arg1),
      b = N3Util.getLiteralValue(arg2);
    return a.indexOf(b) === (a.length - b.length) ? XSD_TRUE : XSD_FALSE;
  },
  contains: function(arg1, arg2) {
    if (!compatibleArguments(arg1, arg2))
      throw new Error('CONTAINS requires compatible arguments');
    return N3Util.getLiteralValue(arg1).indexOf(N3Util.getLiteralValue(arg2)) > -1 ? XSD_TRUE : XSD_FALSE;
  },
  strbefore: function(arg1, arg2) {
    if (!compatibleArguments(arg1, arg2))
      throw new Error('CONTAINS requires compatible arguments');
    var index = N3Util.getLiteralValue(arg1).indexOf(N3Util.getLiteralValue(arg2));
    var lexicalForm = index > -1 ? arg1.substr(index - 1, 1) : '';
    return constructLiteral(lexicalForm, arg1);
  },
  strafter: function(arg1, arg2) {
    if (!compatibleArguments(arg1, arg2))
      throw new Error('CONTAINS requires compatible arguments');

    var a = N3Util.getLiteralValue(arg1),
      b = N3Util.getLiteralValue(arg2);

    var index = a.indexOf(b);
    var lexicalForm = b === "" ? a : index > -1 && (index + arg2.length) < arg1.length ? arg1.substr(index + arg2.length, 1) : '';
    return constructLiteral(lexicalForm, arg1);
  },
  encode_for_uri: function(ltrl) {
    throw new Error('ENCODE_FOR_URI not yet supported');
  },
  concat: function() {
    var lexicalForm = "";
    arguments.forEach(function(arg) {
      lexicalForm += N3Util.getLiteralValue(arg);
    });
    return constructLiteral(lexicalForm, arguments[0]); //TODO: revise,  constructLiteral does not cover everything
  },
  langmatches: function(a, b) {
    return a.toLowerCase() === b.toLowerCase();
  },
  regex: function(subject, pattern) {
    if (N3Util.isLiteral(subject))
      subject = N3Util.getLiteralValue(subject);
    return new RegExp(N3Util.getLiteralValue(pattern)).test(subject);
  },
  replace: function(arg, pattern, replacement, flags) {
    throw new Error('REPLACE not yet supported');
  },
  // 17.4.4 Functions on Numerics
  abs: function(term) {
    return Math.abs(term);
  },
  round: function(term) {
    return Math.abs(term);
  },
  ceil: function(term) {
    return Math.ceil(term);
  },
  floor: function(term) {
    return Math.floor(term);
  },
  rand: function() {
    return Math.random();
  },
  // 17.4.5 Functions on Dates and Times
  now: function() {

  },
  year: function(dt) {

  },
  month: function(dt) {

  },
  day: function(dt) {

  },
  hours: function(dt) {

  },
  minutes: function(dt) {

  },
  seconds: function(dt) {

  },
  timezone: function(dt) {

  },
  tz: function(dt) {

  },
  // 17.4.6 Hash Functions
  md5: function(dt) {

  },
  sha1: function(dt) {

  },
  sha256: function(dt) {

  },
  sha384: function(dt) {

  },
  sha512: function(dt) {

  },
  // 17.5 XPath Constructor Functions
  'http://www.w3.org/2001/XMLSchema#integer': function(a) {

  },
  'http://www.w3.org/2001/XMLSchema#decimal': function(a) {

  },
  'http://www.w3.org/2001/XMLSchema#float': function(a) {

  },
  'http://www.w3.org/2001/XMLSchema#double': function(a) {
    a = a.toFixed();
    if (a.indexOf('.') < 0) a += '.0';
    return '"' + a + '"^^http://www.w3.org/2001/XMLSchema#double';
  },
  'http://www.w3.org/2001/XMLSchema#nonPositiveInteger': function(a) {},
  'http://www.w3.org/2001/XMLSchema#negativeInteger': function(a) {},
  'http://www.w3.org/2001/XMLSchema#long': function(a) {},
  'http://www.w3.org/2001/XMLSchema#int': function(a) {},
  'http://www.w3.org/2001/XMLSchema#short': function(a) {},
  'http://www.w3.org/2001/XMLSchema#byte': function(a) {},
  'http://www.w3.org/2001/XMLSchema#nonNegativeInteger': function(a) {},
  'http://www.w3.org/2001/XMLSchema#unsignedLong': function(a) {},
  'http://www.w3.org/2001/XMLSchema#unsignedInt': function(a) {},
  'http://www.w3.org/2001/XMLSchema#unsignedShort': function(a) {},
  'http://www.w3.org/2001/XMLSchema#unsignedByte': function(a) {},
  'http://www.w3.org/2001/XMLSchema#positiveInteger': function(a) {},
  'http://www.w3.org/2001/XMLSchema#string': function(a) {

  },
  'http://www.w3.org/2001/XMLSchema#boolean': function(a) {

  },
  'http://www.w3.org/2001/XMLSchema#dateTime': function(a) {

  },

};

// Tag all operators that expect their arguments to be numeric
[
  '+', '-', '*', '/', '<', '<=', '>', '>=',
  'abs', 'round', 'ceil', 'floor',
].concat(numeric_types)
  .forEach(function(operatorName) {
    operators[operatorName].type = 'numeric';
  });

// Tag all operators that expect their arguments to be boolean
[
  '!', '&&', '||',
].forEach(function(operatorName) {
  operators[operatorName].type = 'boolean';
});

// Tag all operators that have numeric results
[
  '+', '-', '*', '/', '<', '<=', '>', '>=',
].forEach(function(operatorName) {
  operators[operatorName].type = operators[operatorName].resultType = 'numeric';
});

// Tag all operators that have boolean results
[
  '!', '&&', '||', '=', '<', '<=', '>', '>=', 'langmatches', 'regex',
].forEach(function(operatorName) {
  operators[operatorName].resultType = 'boolean';
});

// Tag all operators that take expressions instead of evaluated expressions
operators.bound.acceptsExpressions = true;

module.exports = SparqlExpressionEvaluator;
