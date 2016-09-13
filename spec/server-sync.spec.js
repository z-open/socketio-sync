var request = require("request");
var sync = require("../lib/server-sync");
var Promise = require('promise');
var base_url = "http://localhost:3000/";

var handler;
var userId;

describe("Sync", function () {
    beforeEach(function () {
        userId = 'UID1234';
        sync.publish(
            'magazines',
            function () {
                return Promise.resolve([]);
            },
            "MAGAZINE");
        handler = {
            user: {
                tenantId: 'TID',
                id: userId,
                display:'John'
            },
            socket: {
                on: function (event, callback) {
                    console.log('Socket.on:' + event);
                },
                emit: function (event, params, callback) {
                    console.log('Socket.emit:' + event+'->'+JSON.stringify(params));
                }
            }
        }

    });
    it("should subscribe and receive the subscription id", function () {
        //expect(1).toEqual(2);
        var subId = sync.subscribe(handler, null, 'magazines', null);
        expect(sync.countActiveSubscriptions()).toBe(1);
        expect(subId).toBeDefined();

    });

    it("should unsubscribe", function () {
        //expect(1).toEqual(2);
        var subId = sync.subscribe(handler, null, 'magazines', null);
        expect(subId).toBeDefined();
        sync.unsubscribe(userId, subId);
        expect(sync.countActiveSubscriptions()).toBe(0);

        // because sync still has the previous connection!!! need to tear down or reinit sync..
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
});