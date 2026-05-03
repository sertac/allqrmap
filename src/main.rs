use axum::{
    extract::State,
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePoolOptions, FromRow, SqlitePool};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Debug, Serialize, Deserialize, FromRow)]
struct Restaurant {
    id: i64,
    name: String,
    lat: f64,
    lng: f64,
    menu_url: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "allqrmap=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Database setup
    let db_url = "sqlite:restaurants.db";
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(db_url)
        .await?;

    // Initialize database schema and seed data
    init_db(&pool).await?;

    // CORS configuration
    let cors = CorsLayer::permissive();

    // Application router
    let app = Router::new()
        .route("/api/restaurants", get(get_restaurants))
        .nest_service("/", ServeDir::new("static"))
        .layer(cors)
        .with_state(pool);

    // Run the server
    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::debug!("listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();

    Ok(())
}

async fn init_db(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS restaurants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            menu_url TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM restaurants")
        .fetch_one(pool)
        .await?;

    if count == 0 {
        tracing::info!("Seeding database with sample restaurants...");
        let restaurants = vec![
            ("Pasta Palace", 40.7128, -74.0060, "https://example.com/pasta"),
            ("Burger Bistro", 40.7306, -73.9352, "https://example.com/burger"),
            ("Sushi Zen", 40.7580, -73.9855, "https://example.com/sushi"),
            ("Taco Town", 40.7829, -73.9654, "https://example.com/taco"),
        ];

        for (name, lat, lng, menu_url) in restaurants {
            sqlx::query("INSERT INTO restaurants (name, lat, lng, menu_url) VALUES (?, ?, ?, ?)")
                .bind(name)
                .bind(lat)
                .bind(lng)
                .bind(menu_url)
                .execute(pool)
                .await?;
        }
    }

    Ok(())
}

async fn get_restaurants(
    State(pool): State<SqlitePool>,
) -> Result<Json<Vec<Restaurant>>, (StatusCode, String)> {
    let restaurants = sqlx::query_as::<_, Restaurant>("SELECT * FROM restaurants")
        .fetch_all(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(restaurants))
}
