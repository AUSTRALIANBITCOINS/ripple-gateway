var config = require(__dirname + '/config/config.js');
var data = require("ripple-gateway-data-sequelize");
var sql = require(__dirname +'/node_modules/ripple-gateway-data-sequelize/lib/sequelize.js');

var RippleWallet = require('ripple-wallet').Ripple.Wallet;
var GatewayProcessManager = require(__dirname+'/lib/processes/');

/**
* List Users
*
* @returns [{User}]
*/

function listUsers(fn) { 
  data.users.readAll(fn);
}

/**
* Clear Withdrawal
*
* @param {integer} id
* @returns [{User}]
*/

function clearWithdrawal(id, fn) {
  var opts = { 
    id: id, 
    status: "cleared"
  };  
  data.externalTransactions.update(opts, fn);
}

/**
* Register a User
* - creates external account named "default"
* - creates ripple address as provided
*
* @param {string} name
* @param {string} rippleAddress 
* @param {string} password
* @returns {User}, {ExternalAccount}, {RippleAddress}
*/

function registerUser(opts, fn) {
  var userOpts = { 
    name: opts.name,
    password: opts.password
  };  
  data.users.create(userOpts, function(err, user) {
    if (err) { fn(err, null); return; }
    var addressOpts = { 
      user_id: user.id,
      address: opts.rippleAddress,
      managed: false,
      type: "independent"
    };  
    data.rippleAddresses.create(addressOpts, function(err, ripple_address) {
      if (err) { fn(err, null); return; };
      data.externalAccounts.create({ name: "default", user_id: user.id }, function(err, account){
        if (err) { fn(err, null); return; }
        var addressOpts = { 
          user_id: user.id,
          address: config.get('COLD_WALLET'),
          managed: true,
          type: "hosted",
          tag: account.id
        };  
        data.rippleAddresses.create(addressOpts, function(err, hosted_address) {
          var response = user.toJSON();
          response.ripple_address = ripple_address;
          response.external_account = account;
          response.hosted_address = hosted_address
          fn(err, response);
        }); 
      }); 
    }); 
  }); 
};

/**
* Record the deposit of an asset
*
* @param {string} currency
* @param {decimal} amount 
* @param {intenger} external_account_id 
* @param {function(err, deposit)} callback
* @returns {Deposit}
*/

function recordDeposit(opts, fn) {

  data.externalTransactions.create({
    external_account_id: opts.external_account_id,
    currency: opts.currency,
    amount: opts.amount,
    deposit: true,
    status: 'queued'
  }, fn); 

}

/**
* Finalize a deposit after processing
*
* @param {integer} id
* @param {integer} ripple_transaction_id 
* @param {function(err, deposit)} callback
* @returns {Deposit}
*/

function finalizeDeposit(opts, fn) {

  data.externalTransactions.update({ 
    id: opts.id,
    ripple_transaction_id: opts.ripple_transaction_id,
    status: "processed"
  }, fn);

}

/**
* List unprocessed deposits
*
* @param {function(err, deposit)} callback
* @returns [Deposit]
*/

function listQueuedDeposits(fn) {

  data.externalTransactions.readAll({
    deposit: true,
    status: 'queued'
  }, fn);

}

/**
* Add a payment to the outgoing queue
*
* @param {string} currency
* @param {decimal} amount
* @param {integer} ripple_address_id
* @param {function(err, deposit)} callback
* @returns [Payment]
*/

function enqueueOutgoingPayment(opts, fn) {
 
  data.rippleTransactions.create({
    to_amount: opts.amount,
    to_currency: opts.currency,
    to_issuer: config.get('COLD_WALLET'),
    from_amount: opts.amount,
    from_currency: opts.currency,
    from_issuer: config.get('COLD_WALLET'),
    to_address_id: opts.to_address_id,
    from_address_id: config.get('HOT_WALLET').id,
    transaction_state: 'outgoing'
  }, fn);
    
}

/**
* List outgoing payments
*
* @param {function(err, deposit)} callback
* @returns [Payment]
*/

function listOutgoingPayments(fn) {

  data.rippleTransactions.readAll({ transaction_state: 'outgoing' }, fn);

}

/**
* List incoming payments
*
* @param {function(err, deposit)} callback
* @returns [Payment]
*/

function listIncomingPayments(fn) {

  data.rippleTransactions.readAll({ transaction_state: 'incoming' }, fn);

}

function recordIncomingNotification(opts, fn) {

  if (opts.transaction_state == 'tesSUCCESS') {
    opts.transaction_state = 'incoming';
    data.rippleTransactions.create(opts, fn);
  } else {
    fn('state not tesSUCCESS', null);
  }

}

/**
* Record incoming payment
*
* @param {integer} destinationTag
* @param {string} currency
* @param {decimal} amount 
* @param {string} state 
* @param {string} hash 
* @param {function(err, deposit)} callback
* @returns {Payment}
*/

function recordIncomingPayment(destinationTag, currency, amount, state, hash, fn) {
  getHostedAddress(destinationTag, function(err, address) {
    if (err && fn) { fn(err, null); return; };
    data.rippleTransactions.create({
        to_amount: amount,
        to_currency: currency,
        to_issuer: config.get('COLD_WALLET'),
        to_amount: amount,
        to_currency: currency,
        to_issuer: config.get('COLD_WALLET'),
        from_address_id: address.id,
        to_address_id: '0',
        transaction_state: state,
        transaction_hash: hash
      }, function(err, rippleTransaction) {
        if (fn) {
          if (err) { fn(err, null); return; };
          fn(null, rippleTransaction);
        }
    });
  });
};

function recordOutgoingNotification(opts, fn) {

  data.rippleTransactions.update({ 
    id: opts.id,
    transaction_state: opts.transaction_state,
    transaction_hash: opts.transaction_hash
  }, fn);

}
/**
* List Pending Withdrawals
*
* @param {function(err, deposit)} callback
* @returns [Withdrawals]
*/

function listPendingWithdrawals(fn) {
  data.externalTransactions.readAllPending(fn);
}

/**
* Issue Currency from Cold Wallet to Hot Wallet
* - the cold wallet's secret must be provided
*
* @param {string} currency 
* @param {decimal} amount 
* @param {string} secret
* @param {function(err, deposit)} callback
* @returns [Withdrawals]
*/

function issueCurrency(amount, currency, secret, fn) {
  var opts = {
    to_account: config.get('HOT_WALLET').address,
    from_account: config.get('COLD_WALLET'),
    amount: amount,
    currency: currency,
    issuer: config.get('COLD_WALLET'),
    secret: secret
  }

  sendCurrency(opts, fn);
}

/**
* Get the public address of the Gateway's cold wallet
* @returns [RippleAddress]
*/

function getColdWalletAddress() {
  return config.get('COLD_WALLET');
}

function getUserAccounts(fn) {
  var query = "select u.id, u.name, address as independent_address, ea.id as external_account_id from users u inner join (select * from ripple_addresses where type='independent') ra on ra.user_id = u.id inner join (select * from external_accounts where name='default') ea on ea.user_id = u.id;"

  sql.query(query).then(function(resp){
    var users = [];
    for (var i=0; i<resp.length; i++) {
      var user = resp[i];
      user.withdraw_address = config.get('COLD_WALLET') + "?dt=" + user.external_account_id
      users.push(user);
    }
    fn(null, users);
  }, function(err) {
    fn(err, null);
  });

}

function getHostedAddress(tag, fn) {
  var params = { address: config.get('COLD_WALLET'), tag: tag };
  data.rippleAddresses.read(params, function(err, address) {
    if (err) { fn(err, null); return; };
    if (address) {
      fn(null, address);
    } else {
      data.rippleAddresses.create(params, fn);
    }
  });
}

function setHotWallet(address, secret, fn) {  
  var key = 'HOT_WALLET'; 
  config.set(key, {
    address: address,
    secret: secret
  });
  config.save(function(){   
    fn(null, gateway.config.get(key));
  });
}

function generateWallet() {

};

function syncHotWalletFromConfigToDatabase(fn){

  var hotWallet = config.get('HOT_WALLET');
  
  if (!hotWallet || !hotWallet.address || !hotWallet.secret) {
    // generate hot wallet
  }

  data.rippleAddresses.read({ address: address }, function(err, address){
    if (err) {
      fn(err, null);
    } else if (address) {
      setHotWallet(address);  
    } else {

    };
  });

}

function getHotWallet(fn) {
  var key = 'HOT_WALLET'; 
  fn(config.get(key));
}

function generateWallet() {
  return RippleWallet.generate(); 
}

function startGateway(opts) {
  processManager = new GatewayProcessManager();
  processManager.start(opts);
}

module.exports = {
  data: data,
  config: config,
  start: startGateway,
  users: {
    register: registerUser,
    list: listUsers,
    listAccounts: getUserAccounts
  },
  deposits: {
    record: recordDeposit,
    listQueued: listQueuedDeposits,
    finalize: finalizeDeposit 
  },
  rippleAddresses: {
    getHosted: getHostedAddress,
    setHotWallet: setHotWallet,
    getHotWallet: getHotWallet,
    generate: generateWallet
  },
  withdrawals: {
    listPending: listPendingWithdrawals,
    clear: clearWithdrawal
  },
  coldWallet: {
    issueCurrency: issueCurrency,
    getAddress: getColdWalletAddress
  },
  payments: {
    enqueueOutgoing: enqueueOutgoingPayment,
    listOutgoing: listOutgoingPayments,
    listIncoming: listIncomingPayments,
    recordIncoming: recordIncomingPayment,
    recordIncomingNotification: recordIncomingNotification,
    recordOutgoingNotification: recordOutgoingNotification
  }
} 

