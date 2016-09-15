var routes = require("../lib/routes");
var api;
var apiRoutes;
var sync;
describe("routes", function () {
    beforeEach(function () {
        apiRoutes = {};
        api = {};
        api.on = function (name, fn) {
            apiRoutes[name] = fn;
            return api;
        };

        sync = {
            subscribe: function () { },
            unsubscribe: function () { }
        }

        routes(api, sync);

        spyOn(sync, 'subscribe');
        spyOn(sync, 'unsubscribe');

    });

    it("should register subscribe route", function () {
        callApi(
            'sync.subscribe',
            { id: 'sub#1', publication: 'magazine', params: { type: 'fiction' } }
        );
        expect(sync.subscribe).toHaveBeenCalled();
        // need to check params
    });

    it("should registerunsubscribe", function () {
        callApi('sync.subscribe', 'sub#1');
        expect(sync.subscribe).toHaveBeenCalled();
    });

    function callApi(name, params) {
        apiRoutes[name](params);
    }
});