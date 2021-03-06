goog.provide('olcs.VectorSynchronizer');
goog.require('ol.source.Vector');
goog.require('ol.layer.Layer');
goog.require('ol.source.Cluster');
goog.require('ol.layer.Image');

goog.require('goog.asserts');
goog.require('ol');
goog.require('ol.events');
goog.require('ol.layer.Vector');
goog.require('olcs.AbstractSynchronizer');
goog.require('olcs.FeatureConverter');
/**
 * Unidirectionally synchronize OpenLayers vector layers to Cesium.
 * @param {!ol.Map} map
 * @param {!Cesium.Scene} scene
 * @param {olcs.FeatureConverter=} opt_converter
 * @constructor
 * @extends {olcs.AbstractSynchronizer.<olcs.core.VectorLayerCounterpart>}
 * @api
 * @struct
 */
olcs.VectorSynchronizer = function(map, scene, opt_converter) {

  /**
   * @protected
   */
  this.converter = opt_converter || new olcs.FeatureConverter(scene);

  /**
   * @private
   */
  this.csAllPrimitives_ = new Cesium.PrimitiveCollection();
  scene.primitives.add(this.csAllPrimitives_);
  this.csAllPrimitives_.destroyPrimitives = false;

  olcs.AbstractSynchronizer.call(this, map, scene);
};
ol.inherits(olcs.VectorSynchronizer, olcs.AbstractSynchronizer);


/**
 * @inheritDoc
 */
olcs.VectorSynchronizer.prototype.addCesiumObject = function(counterpart) {
  goog.asserts.assert(counterpart);
  counterpart.getRootPrimitive()['counterpart'] = counterpart;
  this.csAllPrimitives_.add(counterpart.getRootPrimitive());
};


/**
 * @inheritDoc
 */
olcs.VectorSynchronizer.prototype.destroyCesiumObject = function(object) {
  object.getRootPrimitive().destroy();
};


/**
 * @inheritDoc
 */
olcs.VectorSynchronizer.prototype.removeSingleCesiumObject = function(object, destroy) {
  object.destroy();
  this.csAllPrimitives_.destroyPrimitives = destroy;
  this.csAllPrimitives_.remove(object.getRootPrimitive());
  this.csAllPrimitives_.destroyPrimitives = false;
};


/**
 * @inheritDoc
 */
olcs.VectorSynchronizer.prototype.removeAllCesiumObjects = function(destroy) {
  this.csAllPrimitives_.destroyPrimitives = destroy;
  if (destroy) {
    for (let i = 0; i < this.csAllPrimitives_.length; ++i) {
      this.csAllPrimitives_.get(i)['counterpart'].destroy();
    }
  }
  this.csAllPrimitives_.removeAll();
  this.csAllPrimitives_.destroyPrimitives = false;
};

/**
 * Synchronizes the layer visibility properties
 * to the given Cesium Primitive.
 * @param {olcsx.LayerWithParents} olLayerWithParents
 * @param {!Cesium.Primitive} csPrimitive
 */
olcs.VectorSynchronizer.prototype.updateLayerVisibility = function(olLayerWithParents, csPrimitive) {
  let visible = true;
  [olLayerWithParents.layer].concat(olLayerWithParents.parents).forEach((olLayer) => {
    const layerVisible = olLayer.getVisible();
    if (layerVisible !== undefined) {
      visible &= layerVisible;
    } else {
      visible = false;
    }
  });
  csPrimitive.show = visible;
};
/**
 * @inheritDoc
 */
olcs.VectorSynchronizer.prototype.createSingleLayerCounterparts = function(olLayerWithParents) {
  const olLayer = olLayerWithParents.layer;
  if (!(olLayer instanceof ol.layer.Vector)) {
    return null;
  }
  goog.asserts.assertInstanceof(olLayer, ol.layer.Layer);

  let source = olLayer.getSource();
  if (source instanceof ol.source.Cluster) {
    source = source.getSource();
  }

  goog.asserts.assertInstanceof(source, ol.source.Vector);
  goog.asserts.assert(this.view);

  const view = this.view;
  const featurePrimitiveMap = {};
  const counterpart = this.converter.olVectorLayerToCesium(olLayer, view,
      featurePrimitiveMap);
  const csPrimitives = counterpart.getRootPrimitive();
  const olListenKeys = counterpart.olListenKeys;

  [olLayerWithParents.layer].concat(olLayerWithParents.parents).forEach((olLayerItem) => {
    olListenKeys.push(ol.events.listen(olLayerItem, 'change:visible', () => {
      this.updateLayerVisibility(olLayerWithParents, csPrimitives);
    }));
  });
  this.updateLayerVisibility(olLayerWithParents, csPrimitives);

  const onAddFeature = (function(feature) {
    goog.asserts.assert(
        (olLayer instanceof ol.layer.Vector) ||
        (olLayer instanceof ol.layer.Image)
    );
    const context = counterpart.context;
    const prim = this.converter.convert(olLayer, view, feature, context);
    if (prim) {
      featurePrimitiveMap[ol.getUid(feature)] = prim;
      csPrimitives.add(prim);
    }
  }).bind(this);

  const onRemoveFeature = (function(feature) {
    const geometry = feature.getGeometry();
    const id = ol.getUid(feature);
    if (!geometry || geometry.getType() == 'Point') {
      const context = counterpart.context;
      const bb = context.featureToCesiumMap[id];
      delete context.featureToCesiumMap[id];
      if (bb instanceof Cesium.Billboard) {
        context.billboards.remove(bb);
      }
    }
    const csPrimitive = featurePrimitiveMap[id];
    delete featurePrimitiveMap[id];
    if (csPrimitive) {
      csPrimitives.remove(csPrimitive);
    }
  }).bind(this);

  olListenKeys.push(ol.events.listen(source, 'addfeature', (e) => {
    goog.asserts.assert(e.feature);
    onAddFeature(e.feature);
  }, this));

  olListenKeys.push(ol.events.listen(source, 'removefeature', (e) => {
    goog.asserts.assert(e.feature);
    onRemoveFeature(e.feature);
  }, this));

  olListenKeys.push(ol.events.listen(source, 'changefeature', (e) => {
    const feature = e.feature;
    goog.asserts.assert(feature);
    onRemoveFeature(feature);
    onAddFeature(feature);
  }, this));

  return counterpart ? [counterpart] : null;
};
