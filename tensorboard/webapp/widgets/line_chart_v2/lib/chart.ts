import {ChartCallbacks, ChartOption, IChart} from './chart_types';
import {Coordinator} from './coordinator';
import {
  DataSeries,
  DataSeriesMetadataMap,
  Dimension,
  Extent,
} from './internal_types';
import {
  ObjectRenderer,
  RendererType,
  SvgRenderer,
  ThreeRenderer,
} from './renderer';
import {createScale} from './scale';
import {ScaleType} from './scale_types';
import {SeriesLineView} from './series_line_view';
import {ThreeCoordinator} from './threejs_coordinator';

/**
 * Workaround for testability.
 *
 * Inside TensorBoard unit test, we set up zone.js for Angular components and it patches
 * asynchronousity. For unknown reasons, `fakeAsync` and `flush` misbehave and make test
 * authoring more cumbersome.
 */
const util = {
  requestAnimationFrame: self.requestAnimationFrame,
};

/**
 * Entry point to the charting library.
 */
export class Chart implements IChart {
  private readonly renderer: ObjectRenderer;
  private readonly seriesLineView: SeriesLineView;
  private readonly coordinator: Coordinator;
  private readonly metadataMap: DataSeriesMetadataMap = {};
  private readonly callbacks: ChartCallbacks;

  constructor(option: ChartOption) {
    this.callbacks = option.callbacks;

    switch (option.type) {
      case RendererType.SVG: {
        this.coordinator = new Coordinator();
        this.renderer = new SvgRenderer(option.container);
        break;
      }
      case RendererType.WEBGL: {
        const coordinator = new ThreeCoordinator();
        this.coordinator = coordinator;
        this.renderer = new ThreeRenderer(
          option.container,
          coordinator,
          option.devicePixelRatio
        );
        break;
      }
    }

    this.setXScaleType(option.xScaleType);
    this.setYScaleType(option.yScaleType);

    this.seriesLineView = new SeriesLineView({
      renderer: this.renderer,
      coordinator: this.coordinator,
      getMetadataMap: () => this.metadataMap,
    });

    this.resize(option.domDimension);
  }

  dispose(): void {}

  setXScaleType(type: ScaleType) {
    this.coordinator.setXScale(createScale(type));
  }

  setYScaleType(type: ScaleType) {
    this.coordinator.setYScale(createScale(type));
  }

  resize(dim: Dimension) {
    this.coordinator.setDomContainerRect({x: 0, y: 0, ...dim});
    this.renderer.onResize({x: 0, y: 0, ...dim});
    this.seriesLineView.setLayoutRect({
      ...dim,
      x: 0,
      y: 0,
    });
    this.scheduleRedraw();
  }

  updateMetadata(metadataMap: DataSeriesMetadataMap) {
    let shouldRepaint = false;
    Object.entries(metadataMap).forEach(([id, metadata]) => {
      const existing = this.metadataMap[id];
      if (
        !existing ||
        metadata.color !== existing.color ||
        metadata.visible !== existing.visible ||
        metadata.opacity !== existing.opacity
      ) {
        shouldRepaint = true;
      }

      this.metadataMap[id] = metadata;
    });
    if (shouldRepaint) {
      this.seriesLineView.markAsPaintDirty();
    }
    this.scheduleRedraw();
  }

  updateViewBox(extent: Extent) {
    this.coordinator.setViewBoxRect({
      x: extent.x[0],
      width: extent.x[1] - extent.x[0],
      y: extent.y[0],
      height: extent.y[1] - extent.y[0],
    });
    // Force re-render
    this.seriesLineView.markAsPaintDirty();
    this.scheduleRedraw();
  }

  updateData(data: DataSeries[]) {
    this.seriesLineView.setData(data);
    this.scheduleRedraw();
  }

  private shouldRedraw = false;
  private scheduleRedraw() {
    if (this.shouldRedraw) {
      return;
    }
    this.shouldRedraw = true;
    util.requestAnimationFrame(() => {
      this.redraw();
      this.shouldRedraw = false;
    });
  }

  private redraw() {
    this.seriesLineView.internalOnlyDrawFrame();
    this.renderer.flush();
    this.callbacks.onDrawEnd();
  }
}

export const TEST_ONLY = {
  util,
};
