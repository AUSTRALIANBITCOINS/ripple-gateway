var RippleTransaction = require('../models/ripple_transaction.js');
var Balance = require('../models/balance.js');
var errorResponse = require("../../lib/utils.js").errorResponse;
var util = require('util');

module.exports = (function(){
  function index(req, res){

  }
  
  function update(req, res){
    req.checkBody('txHash', 'Invalid txHash').notEmpty()
    req.checkBody('txState', 'Invalid txStatus').notEmpty()
    if (errors = req.validationErrors()) {
			errorResponse(res)(util.inspect(errors));
    }
    
    RippleTransaction.find(req.params.id).complete(function(err, tx){
      if (err) { res.send({ success: false, error: err}); return false }
      tx.txHash = req.body.txHash  
      tx.txState = req.body.txState
      tx.save().complete(function(err, tx){
        if (err) { res.send({ success: false, error: err}); return false }
        res.send({ success: true, transaction: tx })
      })
    })
  }

  function show(req, res) {
    RippleTransaction.find(req.params.id).complete(function(err, tx){
      if (err) { res.send({ success: false, error: err}); return false }
      res.send({ success: true, transaction: tx })
    })
  }

	function create(req, res) {
		req.body.issuance = false;	
    
    req.checkBody('toCurrency', 'Invalid toCurrency')
      .notEmpty().isAlphanumeric()
    req.checkBody('fromCurrency', 'Invalid fromCurrency')
      .notEmpty().isAlphanumeric()
    req.checkBody('toAmount', 'Invalid toAmount')
      .notEmpty().isDecimal()
    req.checkBody('fromAmount', 'Invalid fromAmount')
      .notEmpty().isDecimal()
    req.checkBody('toAddress', 'Invalid toAddress')
      .notEmpty().isAlphanumeric()
    req.checkBody('fromAddress', 'Invalid fromAddress')
      .notEmpty().isAlphanumeric()
    req.sanitize('deposit').toBoolean()

    var errors = req.validationErrors();
    if (errors) {
			errorResponse(res)(util.inspect(errors));
    }

    console.log('body', req.body)
    RippleTransaction.create(req.body, function(err, tx){
      console.log('error',err)
      console.log('tx', tx)
      if (err) { 
        res.send({ success: false, error: err })
      }
      res.send({ success: true, rippleTransaction: tx });
    })
  }

  return {
    update: update,
    create: create,
		index: index,
    show: show
	}
})();
