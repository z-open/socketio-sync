/**
 * this is the api routes that the client needs to call to subscribe or unsubscribe
 * 
 * client implementation : angular-sync bower package
 */


module.exports = function (api, sync) {
    api
        .on('sync.subscribe', function (params) {
            checkIfVersionCompatible(params.version, sync);
            return sync.subscribe(this.user,this.socket, params.id, params.publication, params.params).id;
        })
        .on('sync.unsubscribe', function (params) {
            checkIfVersionCompatible(params.version, sync);
            return sync.unsubscribe(this.user, params.id);
        });


};

function checkIfVersionCompatible(version, sync) {
    if (version !== sync.getVersion()) {
        console.log('Client Sync version [' + version + '] is incompatible with server version [' + sync.getVersion() + ']');
        throw new Error('CLIENT_SYNC_VERSION_INCOMPATIBLE');
    }
}