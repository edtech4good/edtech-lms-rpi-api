# EdTech LMS RPI API

A specialized API for Raspberry Pi devices in the Educational Technology Learning Management System, designed for offline and edge computing scenarios.

## 🚀 Features

- **Offline Capability**: Designed for Raspberry Pi devices with limited connectivity
- **Data Synchronization**: Sync data between RPI devices and main LMS server
- **Student Progress Tracking**: Track student learning progress on local devices
- **Assessment Management**: Handle quizzes and assessments offline
- **File Management**: Manage educational content and resources locally
- **RESTful API**: Well-documented API with Swagger/OpenAPI documentation
- **Database Migrations**: Sequelize-based database management
- **JWT Authentication**: Secure authentication for RPI devices

## 🛠️ Technology Stack

- **Framework**: NestJS (Node.js)
- **Database**: MySQL with Sequelize ORM
- **Authentication**: JWT (JSON Web Tokens)
- **Documentation**: Swagger/OpenAPI
- **Language**: TypeScript
- **Target Platform**: Raspberry Pi (ARM architecture)

## 📋 Prerequisites

- Node.js (v14 or higher)
- MySQL database
- Raspberry Pi device (optional, can run on any Linux system)

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/edtech-lms-rpi-api.git
cd edtech-lms-rpi-api
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Configuration

Set up your environment variables. The application requires configuration through the `FORTYKAPIRPICONFIG` environment variable.

### 4. Database Setup

Create your MySQL database and run migrations:

```bash
npm run db:migrate
```

### 5. Start the Development Server

```bash
npm run start:dev
```

The API will be available at `http://localhost:3000`

## 📚 API Documentation

Once the server is running, you can access the Swagger documentation at:
- Development: `http://localhost:3000/api`

## 🗂️ Project Structure

```
src/
├── business/          # Business logic services
├── config/           # Configuration files
├── db/              # Database models and migrations
├── decorators/      # Custom decorators
├── filters/         # Exception filters
├── guards/          # Authentication guards
├── interceptors/    # Request/response interceptors
├── middlewares/     # Custom middlewares
├── models/          # Data models and interfaces
├── modules/         # Feature modules
├── pipes/           # Validation pipes
├── services/        # Core services
└── validators/      # Input validation schemas
```

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run linting
npm run lint
```

## 🏗️ Building for Production

```bash
# Build the application
npm run build

# Start production server
npm run start:prod
```

## 📝 Available Scripts

- `npm run start` - Start the application
- `npm run start:dev` - Start in development mode with hot reload
- `npm run start:debug` - Start in debug mode
- `npm run build` - Build the application
- `npm run test` - Run unit tests
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run db:migrate` - Run database migrations

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to contribute to this project.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

If you encounter any issues or have questions:

1. Check the [Issues](https://github.com/your-username/edtech-lms-rpi-api/issues) page
2. Create a new issue if your problem isn't already reported
3. Join our community discussions

## 🙏 Acknowledgments

- Built with [NestJS](https://nestjs.com/)
- Database management with [Sequelize](https://sequelize.org/)
- Documentation with [Swagger](https://swagger.io/)