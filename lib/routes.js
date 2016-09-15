/**
 * this is the api routes that the client needs to call to subscribe or unsubscribe
 * 
 * client implementation : angular-sync bower package
 */
module.exports = function (api, sync) {
    api
        .on('sync.subscribe', function (params) {
            return sync.subscribe(this, params.id, params.publication, params.params);
        })
        .on('sync.unsubscribe', function (id) {
            return sync.unsubscribe(this.userId, id);
        });
};