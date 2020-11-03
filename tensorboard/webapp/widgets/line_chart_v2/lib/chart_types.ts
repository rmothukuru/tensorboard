import {
  DataSeries,
  DataSeriesMetadataMap,
  Dimension,
  Extent,
} from './internal_types';
import {RendererType} from './renderer/renderer_types';
import {ScaleType} from './scale_types';

export interface IChart {
  resize(dim: Dimension): void;

  updateMetadata(metadataMap: DataSeriesMetadataMap): void;

  updateViewBox(extent: Extent): void;

  updateData(data: DataSeries[]): void;

  setXScaleType(type: ScaleType): void;

  setYScaleType(type: ScaleType): void;

  dispose(): void;
}

export interface ChartCallbacks {
  onDrawEnd(): void;
}

export interface BaseChartOption {
  callbacks: ChartCallbacks;
  domDimension: Dimension;
  xScaleType: ScaleType;
  yScaleType: ScaleType;
}

export interface SvgChartOption extends BaseChartOption {
  type: RendererType.SVG;
  container: SVGElement;
}

export interface WebGlChartOption extends BaseChartOption {
  type: RendererType.WEBGL;
  devicePixelRatio: number;
  container: OffscreenCanvas | HTMLCanvasElement;
}

export type ChartOption = SvgChartOption | WebGlChartOption;
