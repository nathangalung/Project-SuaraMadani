import { geoMercator, geoPath } from "d3-geo"
import { feature } from "topojson-client"
import topology from "./provinces.topo.json"

// OSM ODbL, see DESIGN.md
export const MAP_WIDTH = 1000

export type ProvinceShape = { code: string; name: string; d: string }

type Topo = Parameters<typeof feature>[0]
type Collection = Extract<
  Topo["objects"][string],
  { type: "GeometryCollection" }
>

const topo = topology as unknown as Topo
// Also reverse-geocodes report points
export const PROVINCE_FEATURES = feature(
  topo,
  topo.objects.provinces as Collection,
)

function project(): { shapes: ProvinceShape[]; height: number } {
  const collection = PROVINCE_FEATURES
  const projection = geoMercator().fitWidth(MAP_WIDTH, collection)
  const [[, top], [, bottom]] = geoPath(projection).bounds(collection)
  const [x, y] = projection.translate()
  projection.translate([x, y - top])
  // Whole units at 1000 wide
  const path = geoPath(projection).digits(0)
  const shapes = collection.features.map((shape) => {
    const name = shape.properties?.name
    const d = path(shape)
    if (typeof shape.id !== "string" || typeof name !== "string" || !d) {
      throw new Error("province geometry without code")
    }
    return { code: shape.id, name, d }
  })
  return { shapes, height: Math.ceil(bottom - top) }
}

// Once per process
const projected = project()

export const PROVINCE_SHAPES: readonly ProvinceShape[] = projected.shapes
export const MAP_HEIGHT = projected.height

/** Committed provinces.svg, test checks drift. */
export function provinceSprite(): string {
  const paths = PROVINCE_SHAPES.map(
    (shape) => `<path id="p-${shape.code}" d="${shape.d}"/>`,
  )
  return [
    "<!-- Batas wilayah (c) OpenStreetMap contributors, ODbL 1.0 -->",
    '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
    ...paths,
    "</svg>",
    "",
  ].join("\n")
}
