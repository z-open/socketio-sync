var request = require("request");
var sync = require("../lib/server-sync");
var Promise = require('promise');
var base_url = "http://localhost:3000/";
var socket;
var handler;
var userId;
var deferred;

describe("Sync", function () {
    beforeEach(function () {
        deferred = {};
        deferred.promise = new Promise(function (resolve, reject) {
            deferred.resolve = resolve;
        });

        userId = 'UID1234';
        sync.publish(
            'magazines',
            function () {
                return Promise.resolve([]);
            },
            "MAGAZINE");

        socket = {
            on: function (event, callback) {
                console.log('Socket.on:' + event);
            },
            emit: function (event, params, callback) {
                console.log('Socket.emit:' + event + '->' + JSON.stringify(params));
                deferred.resolve(params);
            }
        };

        handler = {
            user: {
                tenantId: 'TID',
                id: userId,
                display: 'John'
            },
            socket: socket
        };

        spyOn(socket, 'emit').and.callThrough();

    });

    afterEach(function () {
        sync.clear();
    });

    it("should subscribe and receive the subscription id", function () {
        var subId = sync.subscribe(handler, null, 'magazines', null);
        expect(sync.countActiveSubscriptions()).toBe(1);
        expect(subId).toBeDefined();

    });

    it("should subscribe and receive subscription id", function (done) {

        var subId = sync.subscribe(handler, null, 'magazines', null);
        waitForNotification().then(function (sub) {
            done();
        })

    });

    it("should unsubscribe", function () {
        var subId = sync.subscribe(handler, null, 'magazines', null);
        expect(subId).toBeDefined();
        sync.unsubscribe(userId, subId);
        expect(sync.countActiveSubscriptions()).toBe(0);
    });


    // it("returns status code 200", function (done) {
    //     done();
    // });
    // describe("GET /", function () {
    //     it("returns status code 200", function (done) {
    //         request.get(base_url, function (error, response, body) {
    //             expect(response.statusCode).toBe(200);
    //             done();
    //         });
    //     });

    //     it("returns Hello World", function (done) {
    //         request.get(base_url, function (error, response, body) {
    //             expect(body).toBe("Hello World");
    //             done();
    //         });
    //     });
    // });

    function waitForNotification() {
        return deferred.promise;
    }

});