'use strict';

var util = require('../util/util');
var ajax = require('../util/ajax');
var browser = require('../util/browser');
var TilePyramid = require('./tile_pyramid');
var normalizeURL = require('../util/mapbox').normalizeSourceURL;
var TileCoord = require('./tile_coord');

exports._loadTileJSON = function(options) {

    var buildPyramid = function (index) {
        this._pyramid = new TilePyramid({
            index: index,
            tileSize: this.tileSize,
            cacheSize: 20,
            minzoom: this.minzoom,
            maxzoom: this.maxzoom,
            roundZoom: this.roundZoom,
            reparseOverscaled: this.reparseOverscaled,
            load: this._loadTile.bind(this),
            abort: this._abortTile.bind(this),
            unload: this._unloadTile.bind(this),
            add: this._addTile.bind(this),
            remove: this._removeTile.bind(this),
            redoPlacement: this._redoTilePlacement ? this._redoTilePlacement.bind(this) : undefined
        });
    }.bind(this);

    var loaded = function(err, tileJSON) {
        if (err) {
            this.fire('error', {error: err});
            return;
        }

        util.extend(this, util.pick(tileJSON,
            ['tiles', 'minzoom', 'maxzoom', 'attribution']));

        if (tileJSON.vector_layers) {
            this.vectorLayers = tileJSON.vector_layers;
            this.vectorLayerIds = this.vectorLayers.map(function(layer) { return layer.id; });
        }

        // if index is defined, fetch the index json, then extend the pyramid
        if (tileJSON.index) {
            ajax.getJSON(normalizeURL(tileJSON.index), function (err, index) {
                if (err) {
                  this.fire('error', {error: err});
                  return;
                }

                buildPyramid(index.index);
                this.fire('load');

            }.bind(this));
        } else {
            buildPyramid();
            this.fire('load');
        }

    }.bind(this);

    var buildPyramid = function (err, index) {
        this._pyramid = new TilePyramid({
            index: index.index,
            tileSize: this.tileSize,
            cacheSize: 20,
            minzoom: this.minzoom,
            maxzoom: this.maxzoom,
            roundZoom: this.roundZoom,
            reparseOverscaled: this.reparseOverscaled,
            load: this._loadTile.bind(this),
            abort: this._abortTile.bind(this),
            unload: this._unloadTile.bind(this),
            add: this._addTile.bind(this),
            remove: this._removeTile.bind(this),
            redoPlacement: this._redoTilePlacement ? this._redoTilePlacement.bind(this) : undefined
        });
    }.bind(this);

    if (options.url) {
        ajax.getJSON(normalizeURL(options.url), loaded);
    } else {
        browser.frame(loaded.bind(this, null, options));
    }
};

exports.redoPlacement = function() {
    if (!this._pyramid) {
        return;
    }

    var ids = this._pyramid.orderedIDs();
    for (var i = 0; i < ids.length; i++) {
        var tile = this._pyramid.getTile(ids[i]);
        this._redoTilePlacement(tile);
    }
};

exports._getTile = function(coord) {
    return this._pyramid.getTile(coord.id);
};


exports._getVisibleCoordinates = function() {
    if (!this._pyramid) return [];
    else return this._pyramid.renderedIDs().map(TileCoord.fromID);
// =======
//     var ids = this._pyramid.renderedIDs();
//     for (var i = 0; i < ids.length; i++) {
//         var tile = this._pyramid.getTile(ids[i]),
//             // coord is different than tile.coord for wrapped tiles since the actual
//             // tile object is shared between all the visible copies of that tile.
//             coord = TileCoord.fromID(ids[i]),
//             z = coord.z,
//             x = coord.x,
//             y = coord.y,
//             w = coord.w;

//         // if z > maxzoom then the tile is actually a overscaled maxzoom tile,
//         // so calculate the matrix the maxzoom tile would use.
//         z = Math.min(z, this.maxzoom);

//         tile.tileExtent = 4096;

//         x += w * (1 << z);
//         tile.calculateMatrices(z, x, y, painter.transform, painter);

//         painter.drawTile(tile, layers);
//     }
// >>>>>>> fix index search to return correct tile id
};

exports._vectorFeaturesAt = function(coord, params, callback) {
    if (!this._pyramid)
        return callback(null, []);

    var result = this._pyramid.tileAt(coord);
    if (!result)
        return callback(null, []);

    this.dispatcher.send('query features', {
        uid: result.tile.uid,
        x: result.x,
        y: result.y,
        tileExtent: result.tile.tileExtent,
        scale: result.scale,
        source: this.id,
        params: params
    }, callback, result.tile.workerID);
};


exports._vectorFeaturesIn = function(bounds, params, callback) {
    if (!this._pyramid)
        return callback(null, []);

    var results = this._pyramid.tilesIn(bounds);
    if (!results)
        return callback(null, []);

    util.asyncAll(results, function queryTile(result, cb) {
        this.dispatcher.send('query features', {
            uid: result.tile.uid,
            source: this.id,
            minX: result.minX,
            maxX: result.maxX,
            minY: result.minY,
            maxY: result.maxY,
            params: params
        }, cb, result.tile.workerID);
    }.bind(this), function done(err, features) {
        callback(err, Array.prototype.concat.apply([], features));
    });
};

/*
 * Create a tiled data source instance given an options object
 *
 * @param {Object} options
 * @param {string} options.type Either `raster` or `vector`.
 * @param {string} options.url A tile source URL. This should either be `mapbox://{mapid}` or a full `http[s]` url that points to a TileJSON endpoint.
 * @param {Array} options.tiles An array of tile sources. If `url` is not specified, `tiles` can be used instead to specify tile sources, as in the TileJSON spec. Other TileJSON keys such as `minzoom` and `maxzoom` can be specified in a source object if `tiles` is used.
 * @param {string} options.id An optional `id` to assign to the source
 * @param {number} [options.tileSize=512] Optional tile size (width and height in pixels, assuming tiles are square). This option is only configurable for raster sources
 * @param {number} options.cacheSize Optional max number of tiles to cache at any given time
 * @example
 * var sourceObj = new mapboxgl.Source.create({
 *    type: 'vector',
 *    url: 'mapbox://mapbox.mapbox-streets-v5'
 * });
 * map.addSource('some id', sourceObj); // add
 * map.removeSource('some id');  // remove
 */
exports.create = function(source) {
    // This is not at file scope in order to avoid a circular require.
    var sources = {
        vector: require('./vector_tile_source'),
        raster: require('./raster_tile_source'),
        geojson: require('./geojson_source'),
        video: require('./video_source'),
        image: require('./image_source')
    };

    for (var type in sources) {
        if (source instanceof sources[type]) {
            return source;
        }
    }

    return new sources[source.type](source);
};
